const POSTGRES_BIGINT_MIN = -(2n ** 63n);
const POSTGRES_BIGINT_MAX = 2n ** 63n - 1n;
const CANONICAL_INTEGER = /^(?:0|-?[1-9]\d*)$/;

function assertPostgresBigIntRange(value: bigint): void {
  if (value < POSTGRES_BIGINT_MIN || value > POSTGRES_BIGINT_MAX) {
    throw new RangeError('Minor-unit amount exceeds PostgreSQL BIGINT range');
  }
}

export function parseMinorUnits(value: string): bigint {
  if (!CANONICAL_INTEGER.test(value)) {
    throw new TypeError('Minor-unit amount must be a canonical integer string');
  }

  const parsed = BigInt(value);
  assertPostgresBigIntRange(parsed);

  return parsed;
}

export function serializeMinorUnits(value: bigint): string {
  assertPostgresBigIntRange(value);
  return value.toString(10);
}
