import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mobile = resolve(root, 'apps/mobile');
const pnpm = 'pnpm';
const platform = process.argv[2];
const submit = process.argv.includes('--submit');

if (!['ios', 'android'].includes(platform)) {
  throw new Error('Uso: node scripts/release-mobile.mjs <ios|android> [--submit]');
}
if (submit && platform !== 'ios') {
  throw new Error('--submit sólo está habilitado para el flujo iOS/TestFlight');
}

function run(args, cwd = root) {
  return new Promise((resolvePromise, reject) => {
    // Node 24 cannot execute the pnpm.cmd shim directly on Windows. Invoke it
    // through cmd.exe without enabling Node's shell interpolation.
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : pnpm;
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', pnpm, ...args] : args;
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${pnpm} ${args.join(' ')} terminó con ${signal ?? `código ${code}`}`));
    });
  });
}

console.log(`Validando Tacos antes del release ${platform}...`);
await run(['catalog:build:mobile']);
await run(['typecheck']);
await run(['smoke:config']);
await run(['--filter', '@tacos/mobile', 'exec', 'expo', 'export', '--platform', 'web']);

const easArgs = [
  'dlx',
  'eas-cli@23.2.0',
  'build',
  '--platform',
  platform,
  '--profile',
  'production'
];
if (submit) easArgs.push('--auto-submit');

console.log(
  submit
    ? 'Las validaciones pasaron. EAS compilará iOS y lo enviará a TestFlight.'
    : `Las validaciones pasaron. EAS compilará ${platform}.`
);
await run(easArgs, mobile);
