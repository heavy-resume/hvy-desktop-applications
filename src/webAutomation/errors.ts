export type WebAutomationErrorCode =
  | 'not_authorized'
  | 'not_authenticated'
  | 'no_profile'
  | 'http_error'
  | 'invalid_request'
  | 'out_of_scope'
  | 'stopped'
  /** The site couldn't be reached: offline, or no connection to it. Nothing reached it, so trying again is safe. */
  | 'unreachable';

/**
 * How a host says a load or request never reached the site (no connection, the name not found), in an error's message:
 * its errors cross to the renderer as text. Both hosts' page script marks a request's; Electron marks a page load's by
 * Chromium's network error. A Tauri load says only that it failed.
 */
export const UNREACHABLE_MARK = '[unreachable]';

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
  /** Unreachable: the site's origin, which a queue waits on before trying again. */
  readonly origin?: string;

  constructor(code: WebAutomationErrorCode, message: string, status?: number, action?: ResponseAction, origin?: string) {
    super(message);
    this.name = 'WebAutomationError';
    this.code = code;
    this.status = status;
    this.action = action;
    this.origin = origin;
  }
}

/** Whether a host's error says its load or request never reached the site. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof WebAutomationError ? error.code === 'unreachable' : errorMessage(error).includes(UNREACHABLE_MARK);
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
