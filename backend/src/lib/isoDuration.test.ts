import { describe, expect, it } from 'vitest';
import { parseIsoDurationMs } from './isoDuration';

describe('parseIsoDurationMs', () => {
  it('parses minutes', () => {
    expect(parseIsoDurationMs('PT30M')).toBe(30 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseIsoDurationMs('PT2H')).toBe(2 * 60 * 60 * 1000);
  });

  it('parses days', () => {
    expect(parseIsoDurationMs('P3D')).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('parses combined date and time components', () => {
    expect(parseIsoDurationMs('P1DT12H')).toBe(24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  });

  it('trims surrounding whitespace', () => {
    expect(parseIsoDurationMs('  PT10M  ')).toBe(10 * 60 * 1000);
  });

  it('rejects an empty duration', () => {
    expect(() => parseIsoDurationMs('P')).toThrow(/invalide/);
    expect(() => parseIsoDurationMs('PT')).toThrow(/invalide/);
    expect(() => parseIsoDurationMs('')).toThrow(/invalide/);
  });

  it('rejects malformed input', () => {
    expect(() => parseIsoDurationMs('30 minutes')).toThrow(/invalide/);
    expect(() => parseIsoDurationMs('P1X')).toThrow(/invalide/);
  });

  it('rejects a zero duration', () => {
    expect(() => parseIsoDurationMs('PT0S')).toThrow(/supérieure à zéro/);
  });
});
