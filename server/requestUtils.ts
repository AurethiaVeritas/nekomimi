export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 200;

export function withPaginationMetadata<T>(result: { items: T[]; total: number; page: number; pageSize: number }) {
  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / result.pageSize);
  return {
    ...result,
    totalPages,
    hasNext: totalPages > 0 && result.page < totalPages,
    hasPrev: result.total > 0 && result.page > 1,
  };
}

export const toArrayParam = (input: unknown) => {
  if (input === undefined || input === null) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .flatMap(v => String(v ?? '').split(','))
    .map(v => v.trim())
    .filter(Boolean);
};

export const toStringParam = (input: unknown) => {
  if (input === undefined || input === null) return undefined;
  if (Array.isArray(input)) {
    const [first] = input;
    return first !== undefined && first !== null ? String(first) : undefined;
  }
  return String(input);
};

export const parseBooleanParam = (input: unknown, defaultValue = false) => {
  const raw = toStringParam(input);
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
};

export const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

