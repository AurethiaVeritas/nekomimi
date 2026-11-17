import { describe, expect, it } from 'vitest'

describe('saved work grid state', () => {
  it('drops every Home and Search page after metadata changes while preserving preferences', async () => {
    const { clearSavedWorkGridStates } = await import('../../client/src/lib/workGridState.js')
    const entries = new Map([
      ['home:state:sfw::24', 'old first page'],
      ['home:state:r18::24', 'old filtered page'],
      ['search:state:{"q":"test"}::24', 'old search page'],
      ['circles_sort', 'count_desc'],
      ['home:lastQuery', 'test'],
    ])
    const storage = {
      get length() { return entries.size },
      key(index: number) { return [...entries.keys()][index] ?? null },
      removeItem(key: string) { entries.delete(key) },
    }

    clearSavedWorkGridStates(storage)

    expect([...entries]).toEqual([
      ['circles_sort', 'count_desc'],
      ['home:lastQuery', 'test'],
    ])
  })
})
