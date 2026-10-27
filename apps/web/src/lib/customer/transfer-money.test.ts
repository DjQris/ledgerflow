import { describe, expect, it } from 'vitest';

import { isCanonicalPositiveMinor, parseNgnToMinor } from './transfer-money';

describe('NGN to kobo parsing', () => {
  it.each([
    ['1000', '100000'],
    ['1000.50', '100050'],
    ['0.01', '1'],
    ['0.1', '10'],
    ['0001.2', '120'],
  ])('converts %s to exact minor units', (amount, expected) => {
    expect(parseNgnToMinor(amount)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '0.00',
    '-1',
    '+1',
    '1.001',
    '1.',
    '.01',
    '1e3',
    ' 1',
    '1,000',
  ])('rejects malformed or non-positive amount %s', (amount) =>
    expect(() => parseNgnToMinor(amount)).toThrow(),
  );

  it('rejects values outside PostgreSQL BIGINT and validates backend amount strings', () => {
    expect(() => parseNgnToMinor('92233720368547758.08')).toThrow(
      /supported transfer limit/,
    );
    expect(parseNgnToMinor('92233720368547758.07')).toBe('9223372036854775807');
    expect(isCanonicalPositiveMinor('100050')).toBe(true);
    expect(isCanonicalPositiveMinor('01')).toBe(false);
    expect(isCanonicalPositiveMinor('0')).toBe(false);
    expect(isCanonicalPositiveMinor('9223372036854775808')).toBe(false);
  });
});
