import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMinor } from '../src/lib/money.ts';

test('formats minor-unit strings exactly without floating-point conversion', () => {
  assert.deepEqual(formatMinor('0'), {
    text: '₦0.00',
    accessible: '0 naira and 00 kobo',
  });
  assert.deepEqual(formatMinor('123456789'), {
    text: '₦1,234,567.89',
    accessible: '1,234,567 naira and 89 kobo',
  });
  assert.equal(formatMinor('-5').text, '−₦0.05');
  assert.equal(
    formatMinor('900719925474099312345').text,
    '₦9,007,199,254,740,993,123.45',
  );
});

test('rejects non-canonical or fractional minor-unit strings', () => {
  for (const value of ['', '01', '-0', '1.5', '1e2', '+1', ' 1']) {
    assert.throws(() => formatMinor(value));
  }
});
