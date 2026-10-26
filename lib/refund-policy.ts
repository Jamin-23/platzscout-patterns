// Domain enums, declared locally so this module stays dependency-free.
export type RefundTrigger = "WITHDRAWAL" | "SERVICE_FAILURE" | "ACCOUNT_DELETION";
export type RefundDeductionType =
  | "START_AND_MATCHING"
  | "PRIORITY_PHONE"
  | "EXTRA_RESULT_ROUND"
  | "EXTRA_SPECIALTY"
  | "DOCUMENTED_RESULTS"
  | "PAYMENT_PROCESSING"
  | "PROMO_DISCOUNT";

type RefundPolicyPackage = {
  priceCents: number;
  includedResults: number;
  startValueCents: number;
  variableValueCents: number;
};

export const REFUND_POLICY = {
  packages: {
    starter: {
      priceCents: 2900,
      includedResults: 8,
      startValueCents: 700,
      variableValueCents: 2200
    },
    standard: {
      priceCents: 5900,
      includedResults: 20,
      startValueCents: 1200,
      variableValueCents: 4700
    },
    intensive: {
      priceCents: 11900,
      includedResults: 35,
      startValueCents: 2400,
      variableValueCents: 9500
    }
  } satisfies Record<string, RefundPolicyPackage>,
  addOns: {
    phone_priority: {
      priceCents: 2000,
      includedPhoneUnits: 5,
      startValueCents: 500,
      variableValueCents: 1500,
      valuePerPhoneUnitCents: 300
    },
    extra_results: {
      priceCents: 2900,
      includedResults: 10,
      startValueCents: 600,
      variableValueCents: 2300,
      valuePerResultCents: 230
    },
    extra_specialty: {
      priceCents: 1200,
      startValueCents: 600,
      variableValueCents: 600
    }
  }
} as const;

const STRIPE_TRANSACTION_FEE_RATE_BPS = 150;

export type RefundDeductionPolicyItem = {
  type: RefundDeductionType;
  label: string;
  amountCents: number;
  explanation: string;
  customerVisible: boolean;
};

export type RefundCalculationSnapshot = {
  packageKey?: string | null;
  selectedAddOns?: Record<string, unknown> | null;
  status?: string | null;
  paidAmountCents: number;
  originalAmountCents: number;
  promoDiscountCents?: number | null;
  alreadyRefundedCents?: number | null;
  paymentProcessingCostCents?: number | null;
  stripeFeeCents?: number | null;
  serviceStarted?: boolean;
  serviceCompleted?: boolean;
  documentedResultsCount?: number | null;
  includedResultsCount?: number | null;
  priorityPhoneProcessedCount?: number | null;
  extraResultRoundProcessedCount?: number | null;
  extraSpecialtyProcessed?: boolean | null;
  dataUnclear?: boolean;
};

export type RefundCalculationOptions = {
  adminCustomAmountCents?: number | null;
  paymentProcessingCostCustomerDeductible?: boolean;
};

export type RefundCalculationResult = {
  paidAmountCents: number;
  originalAmountCents: number;
  promoDiscountCents: number;
  alreadyRefundedCents: number;
  availableRefundCents: number;
  serviceValueCents: number;
  paymentProcessingCostCents: number;
  refundBeforePaymentCostsCents: number;
  paymentProcessingCostDeductedCents: number;
  finalRefundCents: number;
  estimatedRefundCents: number;
  deductions: RefundDeductionPolicyItem[];
  reviewRequired: boolean;
  calculationExplanation: string;
};

const FINAL_STATUSES = new Set(["COMPLETED", "CANCELLED", "CLOSED", "REFUNDED"]);

function clampCents(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function positiveInt(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : 0;
}

function calculateFallbackPaymentProcessingCostCents(paidAmountCents: number) {
  return Math.ceil((paidAmountCents * STRIPE_TRANSACTION_FEE_RATE_BPS) / 10_000);
}

function selectedQuantity(selectedAddOns: Record<string, unknown> | null | undefined, key: string) {
  return positiveInt(selectedAddOns?.[key]);
}

function variableResultValue(policy: RefundPolicyPackage, documentedResultsCount: number) {
  const count = Math.min(policy.includedResults, Math.max(0, documentedResultsCount));
  return Math.floor((policy.variableValueCents * count) / policy.includedResults);
}

function packageLabel(packageKey: string | null | undefined) {
  if (packageKey === "starter") return "Starter Paket";
  if (packageKey === "standard") return "Standard Paket";
  if (packageKey === "intensive") return "Intensiv Paket";
  return "Gebuchtes Paket";
}

export function calculateRefundEstimateFromSnapshot(
  snapshot: RefundCalculationSnapshot,
  trigger: RefundTrigger,
  options: RefundCalculationOptions = {}
): RefundCalculationResult {
  const paidAmountCents = positiveInt(snapshot.paidAmountCents);
  const originalAmountCents = positiveInt(snapshot.originalAmountCents || paidAmountCents);
  const promoDiscountCents = Math.max(0, positiveInt(snapshot.promoDiscountCents ?? Math.max(0, originalAmountCents - paidAmountCents)));
  const alreadyRefundedCents = positiveInt(snapshot.alreadyRefundedCents);
  const availableRefundCents = Math.max(0, paidAmountCents - alreadyRefundedCents);
  const selectedAddOns = snapshot.selectedAddOns ?? {};
  const deductions: RefundDeductionPolicyItem[] = [];
  let serviceValueCents = 0;

  const packageKey = snapshot.packageKey ?? "standard";
  const packagePolicy = REFUND_POLICY.packages[packageKey as keyof typeof REFUND_POLICY.packages];
  const documentedResultsCount = positiveInt(snapshot.documentedResultsCount);
  const serviceStarted = Boolean(snapshot.serviceStarted || documentedResultsCount > 0);

  if (packagePolicy && serviceStarted) {
    const variableValue = variableResultValue(packagePolicy, documentedResultsCount);
    const packageValue = clampCents(packagePolicy.startValueCents + variableValue, 0, packagePolicy.priceCents);
    serviceValueCents += packageValue;
    deductions.push({
      type: "START_AND_MATCHING",
      label: `${packageLabel(packageKey)}: Start und Matching`,
      amountCents: packagePolicy.startValueCents,
      explanation: "Die Bearbeitung gilt als gestartet, sobald Suchprofil, Radius, Matching, Kandidaten oder Kontaktstrategie bearbeitet wurden.",
      customerVisible: true
    });
    if (variableValue > 0) {
      deductions.push({
        type: "DOCUMENTED_RESULTS",
        label: `${packageLabel(packageKey)}: dokumentierte Praxisergebnisse`,
        amountCents: variableValue,
        explanation: `${Math.min(documentedResultsCount, packagePolicy.includedResults)} von ${packagePolicy.includedResults} vorgesehenen Ergebnissen wurden dokumentiert.`,
        customerVisible: true
      });
    }
  }

  const phoneQuantity = selectedQuantity(selectedAddOns, "phone_priority");
  const phoneProcessed = Math.min(REFUND_POLICY.addOns.phone_priority.includedPhoneUnits * phoneQuantity, positiveInt(snapshot.priorityPhoneProcessedCount));
  if (phoneQuantity > 0 && phoneProcessed > 0) {
    const phonePolicy = REFUND_POLICY.addOns.phone_priority;
    const phoneValue = clampCents(phonePolicy.startValueCents + phoneProcessed * phonePolicy.valuePerPhoneUnitCents, 0, phonePolicy.priceCents * phoneQuantity);
    serviceValueCents += phoneValue;
    deductions.push({
      type: "PRIORITY_PHONE",
      label: "Priorisierte Telefonklärung",
      amountCents: phoneValue,
      explanation: `${phoneProcessed} priorisierte telefonische Einheiten wurden bearbeitet oder organisatorisch dokumentiert.`,
      customerVisible: true
    });
  }

  const extraRoundQuantity = selectedQuantity(selectedAddOns, "extra_results");
  const extraResultsProcessed = Math.min(REFUND_POLICY.addOns.extra_results.includedResults * extraRoundQuantity, positiveInt(snapshot.extraResultRoundProcessedCount));
  if (extraRoundQuantity > 0 && extraResultsProcessed > 0) {
    const extraPolicy = REFUND_POLICY.addOns.extra_results;
    const extraValue = clampCents(extraPolicy.startValueCents + extraResultsProcessed * extraPolicy.valuePerResultCents, 0, extraPolicy.priceCents * extraRoundQuantity);
    serviceValueCents += extraValue;
    deductions.push({
      type: "EXTRA_RESULT_ROUND",
      label: "Zusätzliche Ergebnisrunde",
      amountCents: extraValue,
      explanation: `${extraResultsProcessed} zusätzliche dokumentierte Ergebnisse wurden bearbeitet.`,
      customerVisible: true
    });
  }

  const extraSpecialtyQuantity = selectedQuantity(selectedAddOns, "extra_specialty");
  if (extraSpecialtyQuantity > 0 && snapshot.extraSpecialtyProcessed) {
    const specialtyValue = clampCents(
      documentedResultsCount > 0 ? REFUND_POLICY.addOns.extra_specialty.priceCents : REFUND_POLICY.addOns.extra_specialty.startValueCents,
      0,
      REFUND_POLICY.addOns.extra_specialty.priceCents * extraSpecialtyQuantity
    );
    serviceValueCents += specialtyValue;
    deductions.push({
      type: "EXTRA_SPECIALTY",
      label: "Zusätzliches Fachgebiet",
      amountCents: specialtyValue,
      explanation: documentedResultsCount > 0
        ? "Das zusätzliche Fachgebiet wurde in Matching oder Ergebnisbearbeitung einbezogen."
        : "Das zusätzliche Fachgebiet wurde analysiert oder in das Suchprofil aufgenommen.",
      customerVisible: true
    });
  }

  serviceValueCents = clampCents(serviceValueCents, 0, Math.max(availableRefundCents, originalAmountCents));

  if (promoDiscountCents > 0) {
    deductions.push({
      type: "PROMO_DISCOUNT",
      label: "Rabatt oder Promo Code",
      amountCents: promoDiscountCents,
      explanation: "Rabatte werden nicht ausgezahlt. Erstattbar ist höchstens der tatsächlich gezahlte Betrag abzüglich bereits erfolgter Erstattungen.",
      customerVisible: true
    });
  }

  const storedPaymentProcessingCostCents =
    snapshot.paymentProcessingCostCents === null || snapshot.paymentProcessingCostCents === undefined
      ? snapshot.stripeFeeCents
      : snapshot.paymentProcessingCostCents;
  const paymentProcessingCostCents = positiveInt(storedPaymentProcessingCostCents ?? calculateFallbackPaymentProcessingCostCents(paidAmountCents));
  const refundBeforePaymentCostsCents = clampCents(availableRefundCents - serviceValueCents, 0, availableRefundCents);
  const canDeductProcessingCosts = trigger !== "SERVICE_FAILURE" && (trigger === "WITHDRAWAL" || options.paymentProcessingCostCustomerDeductible);
  const paymentProcessingCostDeductedCents = canDeductProcessingCosts
    ? clampCents(paymentProcessingCostCents, 0, refundBeforePaymentCostsCents)
    : 0;

  if (paymentProcessingCostCents > 0) {
    deductions.push({
      type: "PAYMENT_PROCESSING",
      label: storedPaymentProcessingCostCents === null || storedPaymentProcessingCostCents === undefined
        ? "Stripe Transaktionsgebühr (1,5%)"
        : "Stripe Transaktionsgebühr",
      amountCents: paymentProcessingCostDeductedCents,
      explanation: paymentProcessingCostDeductedCents > 0
        ? "Die von Stripe einbehaltene Transaktionsgebühr wird bei der Erstattung berücksichtigt."
        : "Zahlungsabwicklungskosten wurden gespeichert, aber für diese Erstattung nicht als Abzug verwendet.",
      customerVisible: true
    });
  }

  const finalRefundCents = clampCents(refundBeforePaymentCostsCents - paymentProcessingCostDeductedCents, 0, availableRefundCents);
  const reviewRequired = Boolean(
    snapshot.serviceCompleted ||
      FINAL_STATUSES.has(snapshot.status ?? "") ||
      options.adminCustomAmountCents !== undefined ||
      (trigger === "ACCOUNT_DELETION" && serviceStarted) ||
      paymentProcessingCostDeductedCents > 0 ||
      snapshot.dataUnclear
  );

  return {
    paidAmountCents,
    originalAmountCents,
    promoDiscountCents,
    alreadyRefundedCents,
    availableRefundCents,
    serviceValueCents: clampCents(serviceValueCents, 0, availableRefundCents),
    paymentProcessingCostCents,
    refundBeforePaymentCostsCents,
    paymentProcessingCostDeductedCents,
    finalRefundCents,
    estimatedRefundCents: finalRefundCents,
    deductions,
    reviewRequired,
    calculationExplanation: trigger === "WITHDRAWAL"
      ? "Vorläufige Widerrufsschätzung auf Basis des gezahlten Betrags, dokumentierter Leistungen und bereits erfolgter Erstattungen."
      : "Vorläufige Refund-Schätzung auf Basis des gezahlten Betrags, dokumentierter Leistungen, Zahlungsabwicklungskosten und bereits erfolgter Erstattungen."
  };
}
