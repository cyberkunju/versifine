/**
 * Uniform response envelope. Every JSON response from the API matches this
 * shape so the client never has to branch on whether `success` is missing.
 */

export type Ok<T> = { success: true; data: T };
export type Err = {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
};
export type Envelope<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { success: true, data };
}
