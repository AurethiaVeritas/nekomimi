export function getErrorMessage(error: unknown, fallback = ''): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message || fallback
}
