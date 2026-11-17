const rawBase = import.meta.env.BASE_URL || '/'
let normalized = rawBase
if (!normalized.startsWith('/')) normalized = `/${normalized}`
normalized = normalized.replace(/\/+/g, '/');
if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
if (normalized === '/') normalized = ''

export const basePath = normalized

export function withBasePath(path = ''): string {
  if (!path) return normalized || '/'
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${normalized}${suffix}` || '/'
}
