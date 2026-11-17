const asmrOneMocks = vi.hoisted(() => ({
  retryGet: vi.fn(),
}));

vi.mock('../../scraper/axios', () => ({
  default: { retryGet: asmrOneMocks.retryGet },
}));

import { scrapeWorkMetadataFromAsmrOne } from '../../scraper/asmrOne';

describe('scrapeWorkMetadataFromAsmrOne', () => {
  it('normalizes voice-actor ids without mutating the HTTP response', async () => {
    const responseData = {
      tags: [],
      vas: [{ id: 'remote-id', name: 'Test VA' }],
    };
    asmrOneMocks.retryGet.mockResolvedValue({ data: responseData });

    const metadata = await scrapeWorkMetadataFromAsmrOne(123456);

    expect(metadata.vas[0]?.id).not.toBe('remote-id');
    expect(responseData.vas[0]?.id).toBe('remote-id');
  });

  it.each([[true, 'r18'], [false, 'sfw']])('maps the boolean NSFW field %s', async (nsfw, ageRating) => {
    asmrOneMocks.retryGet.mockResolvedValue({ data: { nsfw, tags: [], vas: [] } });
    expect(await scrapeWorkMetadataFromAsmrOne(123456)).toMatchObject({ ageRating, nsfw });
  });

  it.each([
    ['general', 'sfw', false],
    ['R15', 'r15', false],
    ['R18', 'r18', true],
  ])('prefers the three-level %s category over the NSFW boolean', async (category, ageRating, nsfw) => {
    asmrOneMocks.retryGet.mockResolvedValue({ data: { age_category_string: category, nsfw: !nsfw, tags: [], vas: [] } });
    expect(await scrapeWorkMetadataFromAsmrOne(313636)).toMatchObject({ ageRating, nsfw });
    expect(asmrOneMocks.retryGet).toHaveBeenLastCalledWith(
      'https://api.asmr-200.com/api/workInfo/313636', expect.any(Object),
    );
  });
});
