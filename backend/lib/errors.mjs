export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function mapErrorToHttp(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      payload: {
        error: error.code,
        message: error.message
      }
    };
  }

  const message = error instanceof Error ? error.message : "internal_error";

  switch (message) {
    case "missing_required_claims":
      return { status: 401, payload: { error: "unauthorized", message: "Anmeldung konnte nicht bestätigt werden." } };
    case "invalid_token":
    case "unauthorized":
      return { status: 401, payload: { error: "unauthorized", message: "Nicht autorisiert." } };
    default:
      return { status: 500, payload: { error: "internal_error", message: "Es ist ein interner Fehler aufgetreten." } };
  }
}
