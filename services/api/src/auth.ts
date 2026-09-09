import { SignJWT, jwtVerify } from 'jose';
import type { PublicUser } from './repository.js';

const configuredSecret = process.env.JWT_SECRET?.trim();
if (!configuredSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const secret = new TextEncoder().encode(configuredSecret ?? 'local-development-secret-change-me');

export type AuthTokenClaims = { userId: string; sessionId: string };

export async function issueToken(user: PublicUser, sessionId: string) {
  return new SignJWT({ email: user.email, displayName: user.displayName, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(sessionId)
    .setIssuedAt()
    // Sessions are revocable server-side. Keep the JWT short-lived so a
    // leaked token is useful for a bounded amount of time even before the
    // refresh-token flow is added.
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthTokenClaims | undefined> {
  try {
    const result = await jwtVerify(token, secret);
    const userId = result.payload.sub;
    const sessionId = typeof result.payload.sid === 'string' ? result.payload.sid : result.payload.jti;
    return userId && typeof sessionId === 'string' ? { userId, sessionId } : undefined;
  } catch {
    return undefined;
  }
}
