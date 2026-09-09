import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expoArgs = ['--filter', '@tacos/mobile', 'exec', 'expo', 'config', '--type', 'public', '--json'];

function run(env) {
  const windows = process.platform === 'win32';
  const command = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const args = windows ? ['/d', '/s', '/c', `pnpm.cmd ${expoArgs.join(' ')}`] : expoArgs;
  return spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

const invalid = run({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_URL: 'http://localhost:4000', GOOGLE_MAPS_API_KEY: '' });
if (invalid.error || invalid.status === 0 || !`${invalid.stdout ?? ''}\n${invalid.stderr ?? ''}`.includes('EXPO_PUBLIC_API_URL must be an HTTPS')) {
  throw new Error('Production config accepted a non-HTTPS API URL');
}

const missingMaps = run({ EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'android', EXPO_PUBLIC_API_URL: 'https://tacos-api.onrender.com', GOOGLE_MAPS_API_KEY: '' });
if (missingMaps.error || missingMaps.status === 0 || !`${missingMaps.stdout ?? ''}\n${missingMaps.stderr ?? ''}`.includes('GOOGLE_MAPS_API_KEY is required')) {
  throw new Error('Production config accepted a missing Google Maps key');
}

const iosWithoutMaps = run({ EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_API_URL: 'https://tacos-api.onrender.com', GOOGLE_MAPS_API_KEY: '' });
if (iosWithoutMaps.status !== 0) throw new Error(`iOS production config unexpectedly requires Google Maps:\n${iosWithoutMaps.stderr || iosWithoutMaps.stdout}`);
const iosConfig = JSON.parse(iosWithoutMaps.stdout.trim());
if (iosConfig.ios?.bundleIdentifier !== 'com.tacos.app') throw new Error('iOS bundle identifier changed unexpectedly');
if (iosConfig.owner !== 'clubamigostt' || iosConfig.extra?.eas?.projectId !== '155a5800-f93e-4680-9cc4-02450eb830b6') throw new Error('Expo project linkage changed unexpectedly');
if (iosConfig.ios?.supportsTablet !== false) throw new Error('The iPhone-first release must not advertise untested iPad support');
if (!iosConfig.ios?.infoPlist?.NSLocationWhenInUseUsageDescription) throw new Error('iOS location permission copy is missing');
if (!iosConfig.ios?.infoPlist?.NSCameraUsageDescription || !iosConfig.ios?.infoPlist?.NSPhotoLibraryUsageDescription) throw new Error('iOS media permission copy is missing');

const valid = run({ EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'android', EXPO_PUBLIC_API_URL: 'https://tacos-api.onrender.com', GOOGLE_MAPS_API_KEY: 'smoke-key' });
if (valid.status !== 0) throw new Error(`Production config rejected valid environment:\n${valid.stderr || valid.stdout}`);
const config = JSON.parse(valid.stdout.trim());
if (config.extra?.apiUrl !== 'https://tacos-api.onrender.com') throw new Error('Production API URL was not forwarded to Expo config');
if (!config.android?.blockedPermissions?.includes('android.permission.RECORD_AUDIO')) throw new Error('Native permission guard is missing');

console.log('Config smoke passed: production guard and native permission policy');
