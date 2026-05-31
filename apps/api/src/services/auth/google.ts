/**
 * Google Identity Services verifier.
 *
 * The browser receives a Google ID token from GIS and posts it here. We verify
 * the JWT signature against Google's JWKS, then enforce issuer, audience,
 * expiry, stable subject, and verified email before the auth route mints our
 * own Versifine token pair.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../env.ts';
import { errors } from '../../utils/errors.ts';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  hostedDomain: string | null;
}

export function googleAudiences(): string[] {
  const raw = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_IDS].filter(Boolean).join(',');
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function allowedDomains(): string[] {
  return (env.GOOGLE_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function isGoogleAuthConfigured(): boolean {
  return googleAudiences().length > 0;
}

export function isAuthoritativeGoogleEmail(profile: GoogleProfile): boolean {
  return profile.email.endsWith('@gmail.com') || Boolean(profile.hostedDomain);
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  const audiences = googleAudiences();
  if (audiences.length === 0) {
    throw errors.validation('Google sign-in is not configured');
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    const result = await jwtVerify(credential, GOOGLE_JWKS, {
      audience: audiences,
      issuer: [...GOOGLE_ISSUERS],
    });
    payload = result.payload;
  } catch {
    throw errors.unauthorized('Google sign-in could not be verified');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const emailVerified =
    payload.email_verified === true || String(payload.email_verified).toLowerCase() === 'true';
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
  const picture =
    typeof payload.picture === 'string' && payload.picture.trim() ? payload.picture.trim() : null;
  const hostedDomain =
    typeof payload.hd === 'string' && payload.hd.trim() ? payload.hd.trim().toLowerCase() : null;

  if (!sub || !email || !emailVerified) {
    throw errors.unauthorized('Google account email is not verified');
  }

  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const domains = allowedDomains();
  if (domains.length > 0 && !domains.includes(domain) && !domains.includes(hostedDomain ?? '')) {
    throw errors.forbidden('This Google account is not allowed for this workspace');
  }

  return {
    sub,
    email,
    emailVerified,
    name,
    picture,
    hostedDomain,
  };
}
