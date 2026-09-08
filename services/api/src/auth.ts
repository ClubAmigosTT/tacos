import { SignJWT, jwtVerify } from 'jose';
import type { PublicUser } from './repository.js';

const configuredSecret = process.env.JWT_SECRET?.trim();
if (!configuredSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const secret = new TextEncoder().encode(configuredSecret ?? 'local-development-secret-change-me');

export async function issueToken(user: PublicUser) {
  return new SignJWT({ email: user.email, displayName: user.displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | undefined> {
  try {
    const result = await jwtVerify(token, secret);
    return result.payload.sub;
  } catch {
    return undefined;
  }
}
