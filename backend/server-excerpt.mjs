// Excerpt from the production HTTP server (~3,400 lines, all routes, Stripe and
// mail webhooks, SQL). Only the two guards below are published: they show how a
// request is screened before any handler runs. Routes, queries and integration
// code are not included - on request I walk through the full file.
//
// Assembled by hand from the running system; logic unchanged.

function requiresHealthDataConsent(input) {
  return hasHealthRelatedSpecialty(input?.selectedSpecialties) || hasHealthRelatedNotes(input?.notes);
}

function requireVerifiedEmailOrThrow(claims) {
  if (claims?.email_verified === true) return;
  throw new HttpError(
    403,
    "email_verification_required",
    "Bitte bestätige zuerst deine E-Mail-Adresse, bevor du einen Auftrag zahlst oder absendest."
  );
}
