export type WebAutomationErrorCode =
  | 'not_authorized'
  | 'not_authenticated'
  | 'no_profile'
  | 'http_error'
  | 'invalid_request'
  | 'out_of_scope'
  | 'stopped';

/**
 * What a service's response rule (WebApiCapability.responses) says to do about a response: try again later, as a
 * busy service asks; pause the queue the call came from until the user resumes it, as running out of quota needs;
 * or fail it.
 */
export type ResponseAction = 'retry' | 'pause' | 'fail';

export class WebAutomationError extends Error {
  readonly code: WebAutomationErrorCode;
  readonly status?: number;
  /** What the service's response rule that matched says to do; none matched, and the caller's own handling applies. */
  readonly action?: ResponseAction;

  constructor(code: WebAutomationErrorCode, message: string, status?: number, action?: ResponseAction) {
    super(message);
    this.name = 'WebAutomationError';
    this.code = code;
    this.status = status;
    this.action = action;
  }
}

export function errorAction(error: unknown): ResponseAction | undefined {
  return error instanceof WebAutomationError ? error.action : undefined;
}

export function errorCode(error: unknown): WebAutomationErrorCode | 'error' {
  return error instanceof WebAutomationError ? error.code : 'error';
}

export function errorStatus(error: unknown): number | undefined {
  return error instanceof WebAutomationError ? error.status : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
