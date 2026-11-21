import { ApiErrorCode, type ApiErrorBody, type FieldError } from "@smart-waste/shared";

/**
 * Error thrown by route handlers and services. The error handler turns it
 * into the JSON shape defined in `ApiErrorBody`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: FieldError[] | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, details?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }

  static validation(details: FieldError[], message = "Some fields are missing or invalid"): ApiError {
    return new ApiError(400, ApiErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = "Please sign in to continue"): ApiError {
    return new ApiError(401, ApiErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = "You do not have permission to do this"): ApiError {
    return new ApiError(403, ApiErrorCode.FORBIDDEN, message);
  }

  static notFound(what = "Resource"): ApiError {
    return new ApiError(404, ApiErrorCode.NOT_FOUND, `${what} not found`);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, ApiErrorCode.CONFLICT, message);
  }

  static invalidTransition(message: string): ApiError {
    return new ApiError(409, ApiErrorCode.INVALID_TRANSITION, message);
  }

  static rateLimited(message = "Too many attempts. Please wait a few minutes and try again"): ApiError {
    return new ApiError(429, ApiErrorCode.RATE_LIMITED, message);
  }

  static internal(message = "Something went wrong on our side. Please try again"): ApiError {
    return new ApiError(500, ApiErrorCode.INTERNAL_ERROR, message);
  }
}
