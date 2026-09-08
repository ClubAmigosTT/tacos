import { isOpenNow } from '../apps/mobile/lib/hours.ts';

const at = (hour, minute = 0) => new Date(2026, 0, 1, hour, minute);
const cases = [
  ['daytime place is open before closing', isOpenNow('23:00', at(22)), true],
  ['daytime place is closed after midnight', isOpenNow('23:00', at(1)), false],
  ['overnight place is open after midnight', isOpenNow('03:00', at(1)), true],
  ['overnight place is closed midday', isOpenNow('03:00', at(12)), false],
  ['malformed closing time is closed', isOpenNow('not-a-time', at(12)), false]
];

for (const [label, actual, expected] of cases) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

console.log('Hours smoke passed');
