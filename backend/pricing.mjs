import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HttpError } from "./lib/errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pricingCatalog = JSON.parse(readFileSync(path.join(__dirname, "pricing-catalog.json"), "utf8"));

function withPackageCompatibility(pkg) {
  return {
    ...pkg,
    name: pkg.label,
    description: pkg.subtitle,
    maxDocumentedPracticeResults: pkg.documentedResults
  };
}

function withAddonCompatibility(addOn) {
  return {
    ...addOn,
    name: addOn.label,
    description: addOn.shortText
  };
}

export const pricingConfig = {
  currency: pricingCatalog.currency,
  packages: Object.fromEntries(Object.entries(pricingCatalog.packages).map(([key, pkg]) => [key, withPackageCompatibility(pkg)])),
  addOns: Object.fromEntries(Object.entries(pricingCatalog.addons).map(([key, addOn]) => [key, withAddonCompatibility(addOn)]))
};

export const packageKeys = Object.keys(pricingConfig.packages);
export const addOnKeys = Object.keys(pricingConfig.addOns);

export function getPackageByKey(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(pricingConfig.packages, key)
    ? pricingConfig.packages[key]
    : null;
}

export function getAddonByKey(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(pricingConfig.addOns, key)
    ? pricingConfig.addOns[key]
    : null;
}

export function getPackageLabel(key) {
  return getPackageByKey(key)?.label ?? key ?? "Unbekanntes Paket";
}

export function getAddonLabel(key) {
  const addOn = getAddonByKey(key);
  if (addOn) return addOn.label;
  const legacy = typeof key === "string" ? pricingCatalog.deprecatedAliases?.addons?.[key] : null;
  return legacy?.label ?? key ?? "Alte Zusatzleistung";
}

export function getCanonicalAddonKey(key) {
  if (getAddonByKey(key)) return key;
  return pricingCatalog.deprecatedAliases?.addons?.[key]?.canonicalKey ?? null;
}

export function normalizeSelectedAddOns(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = getCanonicalAddonKey(rawKey);
    if (!key) {
      if (Number(rawValue ?? 0) > 0) {
        throw new HttpError(400, "invalid_addon", "Bitte gültige Zusatzleistungen auswählen.");
      }
      continue;
    }
    const quantity = Number(rawValue ?? 0);
    if (Number.isInteger(quantity) && quantity > 0) {
      result[key] = (result[key] ?? 0) + quantity;
    }
  }
  return result;
}

export function calculateSearchRequestPricing(packageKey, selectedAddOnsInput = {}) {
  const pkg = getPackageByKey(packageKey);
  if (!pkg) {
    throw new HttpError(400, "invalid_package", "Bitte ein gültiges Paket auswählen.");
  }

  const selectedAddOns = normalizeSelectedAddOns(selectedAddOnsInput);
  let totalPriceCents = pkg.priceCents;
  let maxDocumentedPracticeResults = pkg.maxDocumentedPracticeResults;
  let priorityPhonePractices = 0;
  let maxSpecialties = pkg.maxSpecialties;
  const normalized = {};

  for (const [key, quantity] of Object.entries(selectedAddOns)) {
    const addOn = getAddonByKey(key);
    if (!addOn) {
      throw new HttpError(400, "invalid_addon", "Bitte gültige Zusatzleistungen auswählen.");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > addOn.maxQuantity) {
      throw new HttpError(400, "invalid_addon_quantity", `${addOn.label} kann maximal ${addOn.maxQuantity} mal gebucht werden.`);
    }
    normalized[key] = quantity;
    totalPriceCents += addOn.priceCents * quantity;
    maxDocumentedPracticeResults += (addOn.maxDocumentedPracticeResultsAdd ?? 0) * quantity;
    priorityPhonePractices += (addOn.priorityPhonePracticesAdd ?? 0) * quantity;
    maxSpecialties += (addOn.maxSpecialtiesAdd ?? 0) * quantity;
  }

  return {
    package: pkg,
    selectedAddOns: normalized,
    totalPriceCents,
    currency: pricingConfig.currency,
    maxDocumentedPracticeResults,
    priorityPhonePractices,
    maxSpecialties
  };
}

export function calculateExpectedListPriceCents(packageKey, addonKeys = []) {
  const selectedAddOns = Array.isArray(addonKeys)
    ? addonKeys.reduce((result, key) => {
        const canonical = getCanonicalAddonKey(key);
        if (canonical) result[canonical] = (result[canonical] ?? 0) + 1;
        return result;
      }, {})
    : normalizeSelectedAddOns(addonKeys);
  return calculateSearchRequestPricing(packageKey, selectedAddOns).totalPriceCents;
}

export function getStripePriceEnvNameForPackage(key) {
  const pkg = getPackageByKey(key);
  if (!pkg) throw new HttpError(400, "invalid_package", "Bitte ein gültiges Paket auswählen.");
  return pkg.stripePriceEnv;
}

export function getStripePriceEnvNameForAddon(key) {
  const canonical = getCanonicalAddonKey(key);
  const addOn = getAddonByKey(canonical);
  if (!addOn) throw new HttpError(400, "invalid_addon", "Bitte gültige Zusatzleistungen auswählen.");
  return addOn.stripePriceEnv;
}

function requiredStripePriceId(envName) {
  const aliasEntries = Object.entries(pricingCatalog.deprecatedAliases?.stripeEnv ?? {});
  const envNames = [
    envName,
    ...aliasEntries.filter(([, canonicalName]) => canonicalName === envName).map(([aliasName]) => aliasName)
  ];
  for (const candidateName of envNames) {
    const value = process.env[candidateName];
    if (value) return value;
  }
  throw new HttpError(500, "missing_stripe_price", `${envName} ist nicht konfiguriert.`);
}

export function resolveStripePriceIdForPackage(key) {
  return requiredStripePriceId(getStripePriceEnvNameForPackage(key));
}

export function resolveStripePriceIdForAddon(key) {
  return requiredStripePriceId(getStripePriceEnvNameForAddon(key));
}

export function allowDevelopmentPriceDataFallback() {
  return process.env.NODE_ENV !== "production" && process.env.STRIPE_ALLOW_PRICE_DATA_FALLBACK === "true";
}

export function specialtyLimitMessage(packageKey) {
  if (packageKey === "starter") return "Starter enthält 1 Fachgebiet oder Suchanliegen. Für mehr wähle Standard, Intensiv oder buche ein zusätzliches Fachgebiet dazu.";
  if (packageKey === "standard") return "Standard enthält bis zu 2 Fachgebiete oder Suchanliegen. Für mehr wähle Intensiv oder buche ein zusätzliches Fachgebiet dazu.";
  return "Intensiv enthält bis zu 3 Fachgebiete oder Suchanliegen. Für mehr kannst du zusätzliche Fachgebiete buchen.";
}

export function validateSearchRequestSelection(input) {
  const packageKey = typeof input.packageKey === "string" ? input.packageKey : "standard";
  const pricing = calculateSearchRequestPricing(packageKey, input.selectedAddOns);
  const selectedSpecialties = Array.isArray(input.selectedSpecialties)
    ? input.selectedSpecialties.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];

  if (selectedSpecialties.length === 0) {
    throw new HttpError(400, "selected_specialties_required", "Bitte mindestens ein Fachgebiet auswählen.");
  }
  if (selectedSpecialties.length > pricing.maxSpecialties) {
    throw new HttpError(400, "too_many_specialties", specialtyLimitMessage(packageKey));
  }

  const radiusKm = Number(input.radiusKm);
  if (!Number.isInteger(radiusKm) || radiusKm < pricing.package.radiusMinKm || radiusKm > pricing.package.radiusMaxKm) {
    throw new HttpError(400, "invalid_radius", `Der Suchradius muss zwischen ${pricing.package.radiusMinKm} und ${pricing.package.radiusMaxKm} km liegen.`);
  }

  const postalCode = typeof input.postalCode === "string" ? input.postalCode.trim() : "";
  const city = typeof input.city === "string" ? input.city.trim() : "";
  if (!postalCode && !city) {
    throw new HttpError(400, "location_required", "Bitte PLZ oder Ort angeben.");
  }
  if (postalCode && !/^\d{5}$/.test(postalCode)) {
    throw new HttpError(400, "invalid_postal_code", "Bitte eine plausible fünfstellige PLZ angeben.");
  }

  return {
    packageKey,
    pricing,
    selectedSpecialties,
    radiusKm,
    postalCode,
    city
  };
}
