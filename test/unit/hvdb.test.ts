const hvdbMocks = vi.hoisted(() => ({
  retryGet: vi.fn(),
}));

vi.mock('../../scraper/axios', () => ({
  default: { retryGet: hvdbMocks.retryGet },
}));

import { scrapeWorkMetadataFromHVDB } from '../../scraper/hvdb';

describe('scrapeWorkMetadataFromHVDB', () => {
  beforeEach(() => {
    hvdbMocks.retryGet.mockReset();
  });

  it('extracts title, circle, safety flag, tags, and complete voice-actor names', async () => {
    hvdbMocks.retryGet.mockResolvedValue({
      data: `
        <input id="Name" value="HVDB &amp; Work" />
        <a class="detailCircle" href="/Dashboard/CircleWorks/12345">Test Circle / テスト</a>
        <input name="SFW" checked />
        <a href="/Dashboard/TagWorks/77">Relaxation &amp; Sleep</a>
        <a href="/Dashboard/CVWorks/88">Jane Doe</a>
      `,
    });

    const metadata = await scrapeWorkMetadataFromHVDB(123456);

    expect(metadata).toMatchObject({
      id: 123456,
      title: 'HVDB & Work',
      circle: { id: '12345', name: 'Test Circle' },
      nsfw: false,
      ageRating: 'sfw',
      tags: [{ id: '77', name: 'Relaxation & Sleep' }],
      vas: [{ name: 'Jane Doe' }],
    });
    expect(metadata.vas[0]?.id).toEqual(expect.any(String));
  });

  it('maps unchecked SFW to R-18', async () => {
    hvdbMocks.retryGet.mockResolvedValue({ data: '<input name="SFW" /><a href="/Dashboard/TagWorks/77">Fixture</a>' });
    expect(await scrapeWorkMetadataFromHVDB(123456)).toMatchObject({ ageRating: 'r18', nsfw: true });
  });
});
