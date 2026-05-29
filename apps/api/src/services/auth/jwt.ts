/**
 * JWT issuance and verification.
 *
 * Two distinct secrets so a leak of the access secret can't be used to mint
 * refresh tokens. Refresh tokens get hashed (SHA-256) before storage so a
 * DB dump alone can't be replayed; rotation invalidates the prior refresh
 * the moment a new one is minted.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../../env.ts';
import { errors } from '../../utils/errors.ts';

const ACCESS_SECRET = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(env.JWT_REFRESH_SECRET);
const ISSUER = 'versifine.api';
const AUDIENCE = 'versifine.web';

export interface AccessClaims {
  sub: string; // user id
  asid: string; // active space id
}

export interface RefreshClaims {
  sub: string;
  /** Random nonce ensures each refresh token is unique even when minted in the same second. */
  nonce: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return await new SignJWT({ asid: claims.asid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`)
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(claims: { sub: string }): Promise<{ token: string; nonce: string }> {
  const nonce = crypto.randomUUID();
  const token = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_REFRESH_TTL_SECONDS}s`)
    .sign(REFRESH_SECRET);
  return { token, nonce };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.asid !== 'string') {
      throw errors.unauthorized('Malformed token');
    }
    return { sub: payload.sub, asid: payload.asid };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw errors.unauthorized('Token expired');
    if (err instanceof joseErrors.JOSEError) throw errors.unauthorized('Invalid token');
    throw err;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.nonce !== 'string') {
      throw errors.unauthorized('Malformed refresh token');
    }
    return { sub: payload.sub, nonce: payload.nonce };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw errors.unauthorized('Refresh token expired');
    if (err instanceof joseErrors.JOSEError) throw errors.unauthorized('Invalid refresh token');
    throw err;
  }
}

export function hashRefreshToken(token: string): string {
  // Bun: hex-encoded sha256 keeps the column human-greppable.
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}
