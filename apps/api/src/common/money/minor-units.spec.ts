import { parseMinorUnits, serializeMinorUnits } from './minor-units';

describe('minor-unit helpers', () => {
  it('parses and serializes signed integer strings without precision loss', () => {
    const value = parseMinorUnits('9007199254740993');

    expect(value).toBe(9007199254740993n);
    expect(serializeMinorUnits(value)).toBe('9007199254740993');
  });

  it.each(['1.25', '01', '+1', '1e3', '', ' 1'])(
    'rejects non-canonical input %p',
    (value) => {
      expect(() => parseMinorUnits(value)).toThrow(TypeError);
    },
  );

  it('rejects values outside the PostgreSQL BIGINT range', () => {
    expect(() => parseMinorUnits('9223372036854775808')).toThrow(RangeError);
    expect(() => serializeMinorUnits(-(2n ** 63n) - 1n)).toThrow(RangeError);
  });
});
