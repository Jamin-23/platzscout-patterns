# Three decision policies from a production SaaS

These three modules are extracted, unchanged in logic, from **PlatzScout** — a therapy-place
search and outreach SaaS that I built and operated alone (Next.js, TypeScript, PostgreSQL,
Prisma, Stripe, Docker) until it was discontinued. The product had paying customers; these are
the parts where being *confidently wrong* costs real money.

I pulled them out of the running system, removed the database and framework coupling, and kept
the tests. They run on Node's built-in test runner with **zero dependencies**.

```bash
npm test    # Node >= 22.6, no install step
```

## Why policies, not features

Every bug in these three files is a money bug or a state bug:

| Module | What it decides | Why it is isolated |
|---|---|---|
| `lib/refund-policy.ts` | How much a customer gets back, from a frozen snapshot of the order | Legal refund rules are a decision table, not a database query. Same snapshot must always produce the same answer, later, for an audit. |
| `lib/affiliate-commission-policy.ts` | Whether a commission is payable yet, and until when it is held | Commission timing depends on withdrawal deadlines and payment dates — a pure function of dates, so it is testable without a clock. |
| `backend/lib/stripe-webhook-idempotency.mjs` | Whether an incoming Stripe event is processed, retried, or ignored | Stripe retries. Processing the same event twice means double credit. This is a small explicit state machine keyed by `event.id`. |

## Design notes

**Snapshot in, decision out.** `calculateRefundEstimateFromSnapshot` takes package, add-ons,
consumed results, trigger (`WITHDRAWAL` / `SERVICE_FAILURE` / `ACCOUNT_DELETION`) and payment
metadata, and returns the estimate *plus* a human-readable explanation. The database row is a
projection of that decision, not the source of truth — which is what made the calculation
auditable and the tests trivial to write.

**Idempotency as a state machine, not a flag.** A webhook row is `PROCESSING`, `PROCESSED` or
`FAILED`. Registration returns `{alreadyProcessed, shouldCreate, shouldRetry}`, so the route
handler never improvises: a duplicate `PROCESSED` event is skipped, a `FAILED` event is retried
with an incremented attempt counter.

**Dates as inputs.** Nothing in these modules reads `Date.now()` internally. Time is passed in,
so tests can pin it.

## What is deliberately not here

- Product logic: provider matching, ranking, outreach sequences, pricing of the commercial
  offering as a whole — that was the actual product and it stays private.
- The database schema, migrations, and any customer or provider data.
- Infrastructure: Docker, Caddy, Keycloak. (Happy to walk through the deployment in a call.)

Package names and price points in `REFUND_POLICY` come from the discontinued product; the
mechanism is what is being shown, not the commercial terms.

Test names are in German, because that is the language the system was specified in.

## Licence

MIT — see [LICENSE](LICENSE).
