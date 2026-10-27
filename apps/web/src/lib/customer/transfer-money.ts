const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const NGN_AMOUNT = /^\d+(?:\.\d{1,2})?$/;

/** Parse a user-entered NGN decimal directly into integer kobo. */
export function parseNgnToMinor(amount: string): string {
  if (!NGN_AMOUNT.test(amount)) {
    throw new Error(
      'Enter a positive NGN amount with at most two decimal places.',
    );
  }
  const [wholePart, fractionPart = ''] = amount.split('.');
  const minor =
    BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, '0') || '0');
  if (minor <= 0n) throw new Error('Amount must be greater than zero.');
  if (minor > POSTGRES_BIGINT_MAX)
    throw new Error('Amount exceeds the supported transfer limit.');
  return minor.toString();
}

export function isCanonicalPositiveMinor(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= POSTGRES_BIGINT_MAX;
  } catch {
    return false;
  }
}
