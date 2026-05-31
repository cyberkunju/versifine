/**
 * Tiny shared flag so the floating WhatsApp button (`WhatsAppFab`) and the
 * first-visit invite popup (`WhatsAppInvite`) don't stack on top of each
 * other — both anchor bottom-right. While the invite card is on screen the
 * FAB hides; once the invite is dismissed or actioned, the FAB returns.
 */
class WaInviteState {
  /** True while the first-visit invite popup is visible. */
  open = $state(false);
}

export const waInvite = new WaInviteState();
