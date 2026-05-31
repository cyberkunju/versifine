/**
 * Validation middleware wrapper.
 *
 * `@hono/zod-validator` short-circuits a failed validation with its OWN
 * response shape (`{ success:false, error:{ issues, name } }`) — which does
 * NOT match our standard envelope (`{ success:false, error:{ code, message,
 * details } }`). Clients that only read `error.message` therefore get
 * `undefined` and surface a blank or generic error.
 *
 * This wrapper installs a `hook` that, on failure, RETURNS the standard
 * envelope directly (a `c.json(...)` Response). We deliberately do not
 * `throw` from the hook: a throw inside @hono/zod-validator's hook is
 * swallowed by its own dispatch and surfaces as a 500. Returning a Response
 * short-circuits cleanly with our shape — matching errorMiddleware's
 * VALIDATION output so every validation failure looks identical to clients.
 *
 * Drop-in: replace `zValidator('json', schema)` with `validate('json', schema)`.
 */
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodSchema } from 'zod';

export function validate<T extends ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const flat = result.error.flatten();
      // Prefer the first concrete field message ("at least 12 characters"),
      // falling back to a form-level message, then a generic one.
      const firstField = Object.values(flat.fieldErrors).flat().find(Boolean);
      const firstForm = flat.formErrors.find(Boolean);
      const message = firstField ?? firstForm ?? 'Invalid request';
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION',
            message,
            details: { fieldErrors: flat.fieldErrors, formErrors: flat.formErrors },
          },
        },
        400,
      );
    }
  });
}
