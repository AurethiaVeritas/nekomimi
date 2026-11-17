// Preserve the first display name and metadata while removing duplicate labels.
export function normalizeNamedItems<T extends { name: string }>(items: Array<T | string> | undefined): T[] {
  const seen = new Set<string>()
  return (items || [])
    .map(item => (typeof item === 'string' ? { name: item } : item) as T)
    .filter(item => {
      const key = item.name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
