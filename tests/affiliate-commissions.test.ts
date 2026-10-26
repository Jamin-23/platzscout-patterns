import test from "node:test";
import assert from "node:assert/strict";
import { getCommissionHoldUntil, normalizeAffiliateAttributionStatus } from "../lib/affiliate-commission-policy.ts";

test("Affiliate Status normalisiert altes APPROVED zu PAYABLE", () => {
  assert.equal(normalizeAffiliateAttributionStatus("APPROVED"), "PAYABLE");
  assert.equal(normalizeAffiliateAttributionStatus("PENDING"), "PENDING");
  assert.equal(normalizeAffiliateAttributionStatus("PAID"), "PAID");
  assert.equal(normalizeAffiliateAttributionStatus("UNKNOWN"), "PENDING");
});

test("Commission Hold nutzt withdrawalDeadlineAt vor paidAt plus 14 Tage", () => {
  const paidAt = new Date("2026-05-01T10:00:00.000Z");
  const withdrawalDeadlineAt = new Date("2026-05-10T10:00:00.000Z");

  assert.equal(getCommissionHoldUntil({ searchRequest: { paidAt, withdrawalDeadlineAt } })?.toISOString(), withdrawalDeadlineAt.toISOString());
  assert.equal(getCommissionHoldUntil({ searchRequest: { paidAt, withdrawalDeadlineAt: null } })?.toISOString(), "2026-05-15T10:00:00.000Z");
});
