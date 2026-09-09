import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = resolve(root, 'services/api/dist/server.js');
const port = 4020;
const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'test', REQUIRE_EMAIL_VERIFICATION: 'true', DATABASE_URL: '', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });
const base = `http://127.0.0.1:${port}`;
async function request(path, options = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, got ${response.status} ${JSON.stringify(body)}`);
  return body;
}
try {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await request('/health'); break; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
  }
  const email = `security-${Date.now()}@example.com`;
  const registration = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'password123', displayName: 'Security Smoke' }) }, 201);
  if (!registration.verificationRequired || !registration.verificationToken || registration.token) throw new Error('Production-style registration did not require verification');
  const verified = await request('/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: registration.verificationToken }) });
  if (!verified.token || verified.user?.emailVerified !== true) throw new Error('Email verification did not create a session');
  await request('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${verified.token}` } });
  await request('/v1/me', { headers: { authorization: `Bearer ${verified.token}` } }, 401);
  console.log('Security smoke passed: verification and session revocation');
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise((resolveWait) => child.once('close', resolveWait));
  if (output.includes('Unhandled') || output.includes('ERROR')) process.stderr.write(output);
}
