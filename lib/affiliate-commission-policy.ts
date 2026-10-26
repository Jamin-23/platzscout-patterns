export const AFFILIATE_ATTRIBUTION_STATUSES = ["PENDING", "PAYABLE", "PAID", "REJECTED", "CANCELLED"] as const;
export type AffiliateAttributionStatus = typeof AFFILIATE_ATTRIBUTION_STATUSES[number];

export function normalizeAffiliateAttributionStatus(status: string): AffiliateAttributionStatus {
  if (status === "APPROVED") return "PAYABLE";
  if (AFFILIATE_ATTRIBUTION_STATUSES.includes(status as AffiliateAttributionStatus)) return status as AffiliateAttributionStatus;
  return "PENDING";
}

export function getCommissionHoldUntil(input: { eligibleAt?: Date | null; searchRequest?: { withdrawalDeadlineAt?: Date | null; paidAt?: Date | null } | null }) {
  return input.eligibleAt ?? input.searchRequest?.withdrawalDeadlineAt ?? (input.searchRequest?.paidAt ? new Date(input.searchRequest.paidAt.getTime() + 14 * 24 * 60 * 60 * 1000) : null);
}
