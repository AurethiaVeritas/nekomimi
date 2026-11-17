import { describe, expect, it } from 'vitest';
import { createLogEntry, formatConsoleLog, formatLogScalar, humanizeLogKey } from '../../server/logging';

describe('server log formatting', () => {
  it('creates a stable structured entry from console arguments', () => {
    const entry = createLogEntry(
      'warn',
      ['[scan] Completed import scan', { imported: 3, errors: 1 }],
      new Date('2026-09-21T12:34:56.000Z'),
    );

    expect(entry).toEqual({
      level: 'warn',
      message: '[scan] Completed import scan',
      timestamp: '2026-09-21T12:34:56.000Z',
      data: { imported: 3, errors: 1 },
    });
  });

  it('renders scan summaries as labeled, multiline text', () => {
    const output = formatConsoleLog({
      level: 'info',
      message: '[scan] Completed import scan',
      timestamp: '2026-09-21T12:34:56.000Z',
      data: {
        mode: 'new-only',
        startPaths: ['/library/ASMR'],
        imported: 2,
        errors: 0,
        importedSamples: [{ id: '12345', title: 'A quiet night', mediaPath: '/library/ASMR/RJ12345' }],
        durationMs: 1525,
      },
    });

    expect(output).toContain('2026-09-21T12:34:56.000Z INFO  [scan] Completed import scan');
    expect(output).toContain('Mode: New works only');
    expect(output).toContain('Scan paths:\n    • /library/ASMR');
    expect(output).toContain('• RJ12345 — A quiet night');
    expect(output).toContain('Duration: 1.5 s');
  });

  it('humanizes unknown keys and common scalar values', () => {
    expect(humanizeLogKey('coverDownloadCount')).toBe('Cover Download Count');
    expect(formatLogScalar('durationMs', 65_000)).toBe('1m 5s');
    expect(formatLogScalar('enabled', true)).toBe('Yes');
  });
});
