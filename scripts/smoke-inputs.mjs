import { parseOptionalPrice } from '../apps/mobile/lib/validation.ts';

const cases = [
  ['blank is optional', parseOptionalPrice(''), null],
  ['comma decimals are normalized', parseOptionalPrice('12,5'), 12.5],
  ['two decimals are preserved', parseOptionalPrice('44.90'), 44.9],
  ['more than two decimals is rejected', parseOptionalPrice('44.999'), undefined],
  ['non numeric input is rejected', parseOptionalPrice('abc'), undefined],
  ['scientific notation is rejected', parseOptionalPrice('1e3'), undefined],
  ['out of range input is rejected', parseOptionalPrice('100001'), undefined]
];

for (const [label, actual, expected] of cases) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

console.log('Input validation smoke passed');
