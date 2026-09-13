import { isOpenNow } from '../apps/mobile/lib/hours.ts';

const at = (hour, minute = 0) => new Date(2026, 0, 1, hour, minute);
const cases = [
  ['daytime place is open before closing', isOpenNow('23:00', at(22)), true],
  ['daytime place is closed after midnight', isOpenNow('23:00', at(1)), false],
  ['overnight place is open after midnight', isOpenNow('03:00', at(1)), true],
  ['overnight place is closed midday', isOpenNow('03:00', at(12)), false],
  ['malformed closing time is closed', isOpenNow('not-a-time', at(12)), false]
];
const weekly = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, []]));
weekly.thu = [{ open: '18:00', close: '03:00' }];
cases.push(
  ['weekly overnight schedule is open after midnight', isOpenNow('23:00', new Date('2026-01-02T09:00:00.000Z'), weekly), true],
  ['weekly overnight schedule is closed before opening', isOpenNow('23:00', new Date('2026-01-01T07:00:00.000Z'), weekly), false]
);

for (const [label, actual, expected] of cases) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

console.log('Hours smoke passed');
