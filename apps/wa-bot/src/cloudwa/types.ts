/**
 * Types for the WhatsApp Business Cloud API (Meta Graph API) integration.
 */

export interface RelayedWebhookPayload {
  phone: string;
  body: string;
  hasAudio: boolean;
  audioBase64: string | null;
  audioMimetype: string | null;
  hasImage: boolean;
  imageBase64: string | null;
  imageMimetype: string | null;
}

export interface MetaSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

export interface MetaUploadMediaResponse {
  id: string;
}

export interface MetaMediaUrlLookupResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
  messaging_product: 'whatsapp';
}
