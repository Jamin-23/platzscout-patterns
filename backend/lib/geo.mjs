export function createGeoService({ nominatimUrl, userAgent }) {
  const geoCache = new Map();
  let lastNominatimRequestAt = 0;

  async function waitForNominatimSlot() {
    const now = Date.now();
    const waitMs = Math.max(0, 1100 - (now - lastNominatimRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastNominatimRequestAt = Date.now();
  }

  function normalizeAddress(item) {
    const address = item.address ?? {};
    if (address.country_code !== "de") {
      return null;
    }

    const road = address.road ?? address.pedestrian ?? address.footway ?? address.path;
    const houseNumber = address.house_number;
    const street = [road, houseNumber].filter(Boolean).join(" ") || null;

    return {
      label: item.display_name,
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      street,
      postalCode: address.postcode ?? null,
      city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
      countryCode: address.country_code
    };
  }

  async function searchAddresses(query) {
    const cacheKey = query.toLowerCase();
    const cached = geoCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < 24 * 60 * 60 * 1000) {
      return cached.results;
    }

    await waitForNominatimSlot();
    const url = new URL("/search", nominatimUrl);
    const normalizedQuery = /\bdeutschland\b/i.test(query) ? query : `${query}, Deutschland`;
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "de");

    const result = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "application/json"
      }
    });

    if (!result.ok) {
      throw new Error(`Nominatim failed with ${result.status}`);
    }

    const payload = await result.json();
    const results = payload
      .map(normalizeAddress)
      .filter((item) => item && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    geoCache.set(cacheKey, { createdAt: Date.now(), results });
    return results;
  }

  return {
    searchAddresses
  };
}
