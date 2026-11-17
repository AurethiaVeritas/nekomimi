import { beforeAll, describe, expect, it } from 'vitest'

let getGridPageSize: (columns: number, requestedSize: number, maximumSize?: number) => number

beforeAll(async () => {
  ({ getGridPageSize } = await import('../../client/src/lib/gridPagination.js'))
})

describe('getGridPageSize', () => {
  it('keeps an already row-aligned page size', () => {
    expect(getGridPageSize(6, 24)).toBe(24)
  })

  it('rounds a page up to complete the rendered grid row', () => {
    expect(getGridPageSize(5, 24)).toBe(25)
    expect(getGridPageSize(5, 48)).toBe(50)
    expect(getGridPageSize(7, 24)).toBe(28)
  })

  it('stays row-aligned when constrained by the API maximum', () => {
    expect(getGridPageSize(6, 199, 200)).toBe(198)
  })
})

describe('remaining grid scroll space', () => {
  it('reserves the remaining rows while pages load, including a partial row', async () => {
    const { getRemainingGridHeight } = await import('../../client/src/lib/gridPagination.js')
    expect(getRemainingGridHeight(25, true, 3, 500, 24)).toBe(4500)
    expect(getRemainingGridHeight(2, true, 3, 500, 24)).toBe(500)
  })

  it('removes space at the confirmed end, even if the total is stale', async () => {
    const { getRemainingGridHeight } = await import('../../client/src/lib/gridPagination.js')
    expect(getRemainingGridHeight(100, false, 3, 500, 24)).toBe(1)
    expect(getRemainingGridHeight(0, false, 3, 500, 24)).toBe(1)
  })

  it('keeps a page available when the API has more results but no usable total', async () => {
    const { getRemainingGridHeight } = await import('../../client/src/lib/gridPagination.js')
    expect(getRemainingGridHeight(0, true, 2, 380, 24)).toBe(4560)
    expect(getRemainingGridHeight(-1, true, 2, 380, 24)).toBe(4560)
  })
})
