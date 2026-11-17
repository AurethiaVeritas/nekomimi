import { describe, expect, it } from 'vitest';
import { isValidTimeZone, msUntilNextDaily, resolveTimeZone } from '../../server/timezone';

describe('timezone scheduling', () => {
  it('validates IANA timezone names', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/A_Timezone')).toBe(false);
  });

  it('uses a detected timezone and falls back to UTC when it is invalid', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('Not/A_Timezone')).toBe('UTC');
    expect(resolveTimeZone('')).toBe('UTC');
  });

  it('calculates the next daily time in the selected timezone', () => {
    const now = new Date('2026-01-15T06:30:00.000Z'); // 01:30 in New York
    expect(msUntilNextDaily('02:00', 'America/New_York', now)).toBe(30 * 60 * 1000);
  });

  it('calculates UTC daily schedules without a local offset', () => {
    const now = new Date('2026-01-15T01:30:00.000Z');
    expect(msUntilNextDaily('02:00', 'UTC', now)).toBe(30 * 60 * 1000);
  });

  it('accounts for daylight-saving offsets', () => {
    const now = new Date('2026-07-15T05:30:00.000Z'); // 01:30 in New York
    expect(msUntilNextDaily('02:00', 'America/New_York', now)).toBe(30 * 60 * 1000);
  });

  it('schedules tomorrow when today\'s wall-clock time has passed', () => {
    const now = new Date('2026-07-15T06:30:00.000Z'); // 02:30 in New York
    expect(msUntilNextDaily('02:00', 'America/New_York', now)).toBe(23.5 * 60 * 60 * 1000);
  });
});
