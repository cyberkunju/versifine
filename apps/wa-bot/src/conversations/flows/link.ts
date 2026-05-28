/**
 * LINK <code> flow.
 *
 * Sends the OTP + phone to `/auth/phone-link/confirm`. On success we flip
 * the session to LINKED_MAIN; on failure (bad code, expired, already
 * linked elsewhere) we surface a localized error and stay where we are.
 */
import type { Session } from '../../types.ts';
import { ApiClientError, phoneLinkConfirm } from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';
import { setLinked, setState, updateSession } from '../state.ts';

export interface LinkResult {
  text: string;
  linked: boolean;
}

export async function handleLinkCommand(session: Session, code: string): Promise<LinkResult> {
  const m = getMessages(session.language);
  try {
    const result = await phoneLinkConfirm(code, session.phone);
    if (!result.linked) {
      return { text: m.linkInvalid, linked: false };
    }
    // Mark the session as linked. We don't yet have userId/spaceId in this
    // response — the next outbound API call will resolve the user via
    // X-Phone, and the engine populates userId/spaceId on first /capture.
    setState(session.phone, 'LINKED_MAIN');
    updateSession(session.phone, { linked: true });
    return {
      text: m.linkConfirmed(null),
      linked: true,
    };
  } catch (err) {
    if (err instanceof ApiClientError) {
      log.warn('LINK_FAIL', {
        phone: session.phone,
        code: err.code,
        status: err.status,
        message: err.message.slice(0, 200),
      });
      // Distinguish "not found" / "validation" from infrastructure failures.
      if (err.code === 'NOT_FOUND' || err.code === 'VALIDATION' || err.code === 'CONFLICT') {
        return { text: m.linkInvalid, linked: false };
      }
    } else {
      log.warn('LINK_FAIL_UNKNOWN', { phone: session.phone, error: String(err).slice(0, 200) });
    }
    return { text: m.error, linked: false };
  }
}

/**
 * Small helper: when an unlinked user sends an arbitrary message in
 * AWAITING_LINK_CODE, re-prompt with the link instructions instead of
 * sending the greeting again.
 */
export function rePrompt(session: Session): { text: string } {
  const m = getMessages(session.language);
  return { text: m.linkPrompt };
}

// Reference setLinked so the linker doesn't strip the import; future code
// will use it once the API returns userId/spaceId in the link response.
void setLinked;
