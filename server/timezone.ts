const MINUTE_MS = 60 * 1000;
const MAX_SEARCH_MINUTES = 49 * 60;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(value: string): boolean {
  try {
    getTimeFormatter(value).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(detected?: string): string {
  let candidate = detected;
  if (candidate === undefined) {
    try {
      candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      candidate = undefined;
    }
  }
  return candidate && isValidTimeZone(candidate) ? candidate : 'UTC';
}

/**
 * Finds the next occurrence of a wall-clock time in an IANA timezone.
 * Searching real instants keeps daylight-saving gaps and repeated hours correct.
 */
export function msUntilNextDaily(timeStr: string | undefined, timeZone: string, now = new Date()): number {
  const match = typeof timeStr === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim()) : null;
  if (!match || !isValidTimeZone(timeZone)) return 0;

  const hour = Math.max(0, Math.min(23, Number.parseInt(match[1], 10) || 0));
  const minute = Math.max(0, Math.min(59, Number.parseInt(match[2], 10) || 0));
  const formatter = getTimeFormatter(timeZone);
  const firstCandidateMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  for (let offset = 0; offset < MAX_SEARCH_MINUTES; offset += 1) {
    const candidateMs = firstCandidateMs + offset * MINUTE_MS;
    const parts = formatter.formatToParts(new Date(candidateMs));
    const candidateHour = Number(parts.find(part => part.type === 'hour')?.value);
    const candidateMinute = Number(parts.find(part => part.type === 'minute')?.value);
    if (candidateHour === hour && candidateMinute === minute) {
      return candidateMs - now.getTime();
    }
  }

  return 24 * 60 * MINUTE_MS;
}
