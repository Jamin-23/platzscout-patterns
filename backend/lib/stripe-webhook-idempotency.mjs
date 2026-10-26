export function getStripeWebhookRegistrationState(existing) {
  if (!existing) {
    return {
      alreadyProcessed: false,
      shouldCreate: true,
      shouldRetry: false
    };
  }

  if (existing.status === "PROCESSED") {
    return {
      alreadyProcessed: true,
      shouldCreate: false,
      shouldRetry: false
    };
  }

  return {
    alreadyProcessed: false,
    shouldCreate: false,
    shouldRetry: true
  };
}

export function buildStripeWebhookCreateData(event) {
  return {
    eventId: event.id,
    eventType: event.type,
    status: "PROCESSING",
    payload: event
  };
}

export function buildStripeWebhookRetryData(event) {
  return {
    eventType: event.type,
    status: "PROCESSING",
    payload: event,
    lastError: null,
    attemptCount: { increment: 1 }
  };
}
