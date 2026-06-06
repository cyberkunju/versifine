/**
 * Typed shapes for the WhatsApp Business Cloud API (Meta Graph) webhook
 * envelope and the relay payload we forward to the bot process.
 *
 * Only the fields we actually consume are modelled; Meta sends much more.
 */

export interface MetaWebhookEnvelope {
  object?: string;
  entry?: MetaEntry[];
}

export interface MetaEntry {
  id?: string;
  changes?: MetaChange[];
}

export interface MetaChange {
  field?: string;
  value?: MetaChangeValue;
}

export interface MetaChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MetaInboundMessage[];
  statuses?: MetaStatus[];
}

export type MetaMessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'interactive'
  | 'button'
  | 'document'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'order'
  | 'system'
  | 'request_welcome'
  | 'unsupported';

export interface MetaInboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: MetaMessageType;
  text?: { body?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  /** Quick-reply buttons / list selections (interactive messages). */
  interactive?: {
    type?: 'button_reply' | 'list_reply';
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  /** Legacy template-button taps. */
  button?: { payload?: string; text?: string };
  /** Present on unsupported messages — carries the reason. */
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export interface MetaStatus {
  id?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

/** Payload we POST to the bot's internal `/webhook/message`. */
export interface RelayPayload {
  phone: string;
  body: string;
  hasAudio: boolean;
  audioBase64: string | null;
  audioMimetype: string | null;
  hasImage: boolean;
  imageBase64: string | null;
  imageMimetype: string | null;
  /** Meta message id — lets the bot dedupe defensively too. */
  messageId?: string;
}

export interface MetaMediaInfo {
  url?: string;
  mime_type?: string;
  file_size?: number;
  id?: string;
}

export interface MetaSendResult {
  ok: boolean;
  status: number;
  messageId?: string;
  /** Meta error code when ok=false (e.g. 131047 = outside 24h window). */
  errorCode?: number;
  errorMessage?: string;
}
