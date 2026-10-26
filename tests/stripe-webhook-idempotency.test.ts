import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStripeWebhookCreateData,
  buildStripeWebhookRetryData,
  getStripeWebhookRegistrationState
} from "../backend/lib/stripe-webhook-idempotency.mjs";

test("Stripe Webhook wird beim ersten Event zur Verarbeitung registriert", () => {
  const state = getStripeWebhookRegistrationState(null);
  assert.deepEqual(state, {
    alreadyProcessed: false,
    shouldCreate: true,
    shouldRetry: false
  });

  const event = { id: "evt_checkout_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } };
  assert.deepEqual(buildStripeWebhookCreateData(event), {
    eventId: "evt_checkout_1",
    eventType: "checkout.session.completed",
    status: "PROCESSING",
    payload: event
  });
});

test("Duplicate Stripe Webhook wird nach PROCESSED nicht erneut verarbeitet", () => {
  const state = getStripeWebhookRegistrationState({
    eventId: "evt_checkout_1",
    eventType: "checkout.session.completed",
    status: "PROCESSED",
    attemptCount: 1
  });

  assert.deepEqual(state, {
    alreadyProcessed: true,
    shouldCreate: false,
    shouldRetry: false
  });
});

test("Stripe Webhook Retry verarbeitet fehlgeschlagenes Event erneut mit Attempt Increment", () => {
  const event = { id: "evt_refund_1", type: "refund.updated", data: { object: { id: "re_1", status: "succeeded" } } };
  const state = getStripeWebhookRegistrationState({
    eventId: "evt_refund_1",
    eventType: "refund.updated",
    status: "FAILED",
    attemptCount: 1,
    lastError: "temporary"
  });

  assert.deepEqual(state, {
    alreadyProcessed: false,
    shouldCreate: false,
    shouldRetry: true
  });
  assert.deepEqual(buildStripeWebhookRetryData(event), {
    eventType: "refund.updated",
    status: "PROCESSING",
    payload: event,
    lastError: null,
    attemptCount: { increment: 1 }
  });
});
