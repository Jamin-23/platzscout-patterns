import test from "node:test";
import assert from "node:assert/strict";
import { calculateRefundEstimateFromSnapshot } from "../lib/refund-policy.ts";

function base(overrides: Partial<Parameters<typeof calculateRefundEstimateFromSnapshot>[0]> = {}) {
  return {
    packageKey: "starter",
    selectedAddOns: {},
    status: "PAID",
    paidAmountCents: 2900,
    originalAmountCents: 2900,
    alreadyRefundedCents: 0,
    paymentProcessingCostCents: 0,
    serviceStarted: true,
    serviceCompleted: false,
    documentedResultsCount: 0,
    priorityPhoneProcessedCount: 0,
    extraResultRoundProcessedCount: 0,
    extraSpecialtyProcessed: false,
    ...overrides
  };
}

test("Starter Refund direkt nach Matching", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base(), "WITHDRAWAL");
  assert.equal(estimate.serviceValueCents, 700);
  assert.equal(estimate.finalRefundCents, 2200);
});

test("Starter Refund nach 3 von 8 Ergebnissen", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ documentedResultsCount: 3 }), "WITHDRAWAL");
  assert.equal(estimate.serviceValueCents, 1525);
  assert.equal(estimate.finalRefundCents, 1375);
});

test("Starter Refund nach 8 von 8 Ergebnissen", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ documentedResultsCount: 8, serviceCompleted: true }), "WITHDRAWAL");
  assert.equal(estimate.serviceValueCents, 2900);
  assert.equal(estimate.finalRefundCents, 0);
  assert.equal(estimate.reviewRequired, true);
});

test("Standard Refund direkt nach Matching und nach 5 Ergebnissen", () => {
  const start = calculateRefundEstimateFromSnapshot(base({ packageKey: "standard", paidAmountCents: 5900, originalAmountCents: 5900 }), "WITHDRAWAL");
  assert.equal(start.serviceValueCents, 1200);
  assert.equal(start.finalRefundCents, 4700);

  const progress = calculateRefundEstimateFromSnapshot(base({ packageKey: "standard", paidAmountCents: 5900, originalAmountCents: 5900, documentedResultsCount: 5 }), "WITHDRAWAL");
  assert.equal(progress.serviceValueCents, 2375);
  assert.equal(progress.finalRefundCents, 3525);
});

test("Standard Refund nach 20 von 20 Ergebnissen", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ packageKey: "standard", paidAmountCents: 5900, originalAmountCents: 5900, documentedResultsCount: 20 }), "WITHDRAWAL");
  assert.equal(estimate.serviceValueCents, 5900);
  assert.equal(estimate.finalRefundCents, 0);
});

test("Intensiv Refund nutzt Rundung mit exaktem Vollwert", () => {
  const partial = calculateRefundEstimateFromSnapshot(base({ packageKey: "intensive", paidAmountCents: 11900, originalAmountCents: 11900, documentedResultsCount: 1 }), "WITHDRAWAL");
  assert.equal(partial.serviceValueCents, 2671);

  const full = calculateRefundEstimateFromSnapshot(base({ packageKey: "intensive", paidAmountCents: 11900, originalAmountCents: 11900, documentedResultsCount: 35 }), "WITHDRAWAL");
  assert.equal(full.serviceValueCents, 11900);
  assert.equal(full.finalRefundCents, 0);
});

test("Zusatzleistungen werden anteilig bewertet", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({
    paidAmountCents: 8000,
    originalAmountCents: 8000,
    selectedAddOns: { phone_priority: 1, extra_results: 1, extra_specialty: 1 },
    priorityPhoneProcessedCount: 2,
    extraResultRoundProcessedCount: 3,
    extraSpecialtyProcessed: true
  }), "WITHDRAWAL");
  assert.equal(estimate.serviceValueCents, 700 + 1100 + 1290 + 600);
});

test("Zusätzliches Fachgebiet unverarbeitet bleibt ohne Leistungswert", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({
    selectedAddOns: { extra_specialty: 1 },
    extraSpecialtyProcessed: false
  }), "WITHDRAWAL");
  assert.equal(estimate.deductions.some((item) => item.type === "EXTRA_SPECIALTY"), false);
});

test("Promo Code erhöht den Refund nicht", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({
    originalAmountCents: 3900,
    paidAmountCents: 2900,
    promoDiscountCents: 1000,
    serviceStarted: false
  }), "WITHDRAWAL");
  assert.equal(estimate.finalRefundCents, 2900);
});

test("Refund ist nie negativ und nie größer als Restbetrag", () => {
  const highWork = calculateRefundEstimateFromSnapshot(base({ paidAmountCents: 500, originalAmountCents: 2900, documentedResultsCount: 8 }), "WITHDRAWAL");
  assert.equal(highWork.finalRefundCents, 0);

  const partiallyRefunded = calculateRefundEstimateFromSnapshot(base({ alreadyRefundedCents: 1000, serviceStarted: false }), "WITHDRAWAL");
  assert.equal(partiallyRefunded.finalRefundCents, 1900);
});

test("Stripe Fee wird bei Widerruf abgezogen", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ paymentProcessingCostCents: 120, serviceStarted: false }), "WITHDRAWAL");
  assert.equal(estimate.paymentProcessingCostDeductedCents, 120);
  assert.equal(estimate.finalRefundCents, 2780);
});

test("Stripe Fee nutzt 1,5 Prozent Fallback wenn keine echte Stripe Fee gespeichert ist", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ paymentProcessingCostCents: null, stripeFeeCents: null, serviceStarted: false }), "WITHDRAWAL");
  assert.equal(estimate.paymentProcessingCostCents, 44);
  assert.equal(estimate.paymentProcessingCostDeductedCents, 44);
  assert.equal(estimate.finalRefundCents, 2856);
});

test("Stripe Fee kann bei Account Deletion nur mit Flag und Review berücksichtigt werden", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ paymentProcessingCostCents: 120 }), "ACCOUNT_DELETION", {
    paymentProcessingCostCustomerDeductible: true
  });
  assert.equal(estimate.paymentProcessingCostDeductedCents, 120);
  assert.equal(estimate.finalRefundCents, 2080);
  assert.equal(estimate.reviewRequired, true);
});

test("Service Failure zieht keine Stripe Fee ab", () => {
  const estimate = calculateRefundEstimateFromSnapshot(base({ paymentProcessingCostCents: 120, serviceStarted: false }), "SERVICE_FAILURE", {
    paymentProcessingCostCustomerDeductible: true
  });
  assert.equal(estimate.paymentProcessingCostDeductedCents, 0);
  assert.equal(estimate.finalRefundCents, 2900);
});
