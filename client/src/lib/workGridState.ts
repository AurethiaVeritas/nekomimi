const GRID_STATE_PREFIXES = ['home:state:', 'search:state:']

type KeyedStorage = {
  length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export function clearSavedWorkGridStates(storage: KeyedStorage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (key && GRID_STATE_PREFIXES.some(prefix => key.startsWith(prefix))) storage.removeItem(key)
  }
}
