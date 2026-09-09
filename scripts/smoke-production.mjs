import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = resolve(root, 'services/api/dist/server.js');

async function expectMissingDatabaseFailure(target) {
  const child = spawn(process.execPath, [target], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', JWT_SECRET: 'smoke-production-secret', PORT: '4011' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const status = await new Promise((resolveStatus, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Production guard process did not exit: ${target}`));
    }, 8_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveStatus(code ?? 1);
    });
  });
  if (status === 0 || !output.includes('DATABASE_URL is required in production')) {
    throw new Error(`Production target did not reject a missing DATABASE_URL (${target}):\n${output}`);
  }
}

await expectMissingDatabaseFailure(entry);
await expectMissingDatabaseFailure(resolve(root, 'services/api/dist/migrate.js'));
console.log('Production guard smoke passed: API and migrations require DATABASE_URL');
