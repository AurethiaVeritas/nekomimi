import { inspect } from 'node:util';

export type LogLevel = 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel);
}

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
};

const LOG_LABELS: Record<string, string> = {
  mode: 'Mode',
  startPaths: 'Scan paths',
  candidateCount: 'Candidates',
  sampleIds: 'Candidate samples',
  invalidPaths: 'Unavailable paths',
  imported: 'Imported',
  errors: 'Errors',
  importedSamples: 'Imported samples',
  failureSamples: 'Failed items',
  invalidCoverUpdates: 'Invalid covers updated',
  invalidCoverSamples: 'Invalid cover samples',
  durationMs: 'Duration',
  total: 'Items checked',
  updated: 'Updated',
  markedMissing: 'Marked missing',
  updatedSamples: 'Updated samples',
  missingSamples: 'Missing samples',
  errorSamples: 'Error samples',
  error: 'Error',
};

function snapshot(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function createLogEntry(level: LogLevel, args: unknown[], now = new Date()): LogEntry {
  const objects: unknown[] = [];
  const messages: string[] = [];

  for (const arg of args) {
    if (arg instanceof Error) {
      messages.push(arg.message);
      objects.push({ message: arg.message, stack: arg.stack });
    } else if (typeof arg === 'object' && arg !== null) {
      objects.push(snapshot(arg));
    } else {
      messages.push(String(arg));
    }
  }

  return {
    level,
    message: messages.join(' '),
    timestamp: now.toISOString(),
    data: objects.length > 0 ? (objects.length === 1 ? objects[0] : objects) : undefined,
  };
}

export function humanizeLogKey(key: string): string {
  if (LOG_LABELS[key]) return LOG_LABELS[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, char => char.toUpperCase());
}

export function formatLogScalar(key: string, value: unknown): string {
  if (key === 'durationMs' && typeof value === 'number') {
    if (value < 1000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  if (key === 'mode' && typeof value === 'string') {
    return ({
      'new-only': 'New works only',
      full: 'Full library',
      'metadata-only': 'Metadata only',
      alignment: 'Path alignment',
      'dry-run': 'Dry run',
    } as Record<string, string>)[value] || value;
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null) return 'None';
  return String(value);
}

function formatDetailLines(data: unknown, indent = '  '): string[] {
  if (Array.isArray(data)) {
    if (data.length === 0) return [`${indent}None`];
    return data.flatMap(item => {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const identity = record.rjcode || record.id;
        const title = record.title;
        const summary = [identity ? `RJ${String(identity).replace(/^RJ/i, '')}` : '', title].filter(Boolean).join(' — ');
        const lines = [`${indent}• ${summary || 'Item'}`];
        for (const [key, value] of Object.entries(record)) {
          if (key === 'id' || key === 'rjcode' || key === 'title') continue;
          lines.push(`${indent}  ${humanizeLogKey(key)}: ${formatLogScalar(key, value)}`);
        }
        return lines;
      }
      return [`${indent}• ${String(item)}`];
    });
  }

  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).flatMap(([key, value]) => {
      const label = humanizeLogKey(key);
      if (Array.isArray(value)) {
        if (value.length === 0) return [`${indent}${label}: None`];
        return [`${indent}${label}:`, ...formatDetailLines(value, `${indent}  `)];
      }
      if (value && typeof value === 'object') {
        return [`${indent}${label}:`, ...formatDetailLines(value, `${indent}  `)];
      }
      return [`${indent}${label}: ${formatLogScalar(key, value)}`];
    });
  }

  return [`${indent}${String(data)}`];
}

export function formatConsoleLog(entry: LogEntry): string {
  const level = entry.level.toUpperCase().padEnd(5);
  const header = `${entry.timestamp} ${level} ${entry.message || '(no message)'}`;
  if (entry.data === undefined) return header;

  try {
    return [header, ...formatDetailLines(entry.data)].join('\n');
  } catch {
    return `${header}\n  ${inspect(entry.data, { depth: 5, colors: false, breakLength: 100 })}`;
  }
}
