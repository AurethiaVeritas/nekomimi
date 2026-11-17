const dlsiteMocks = vi.hoisted(() => ({
  retryGet: vi.fn(),
  scrapeHvdb: vi.fn(),
}));

vi.mock('../../scraper/axios', () => ({
  default: { retryGet: dlsiteMocks.retryGet },
  isScraperRequestCancelled: (error: unknown) => (
    error !== null && typeof error === 'object' && 'code' in error && error.code === 'ERR_CANCELED'
  ),
}));

vi.mock('../../scraper/hvdb', () => ({
  scrapeWorkMetadataFromHVDB: dlsiteMocks.scrapeHvdb,
}));

import {
  normalizeDlsiteImageUrl,
  scrapeCoverIdForTranslatedWorkFromDLsite,
  scrapeDynamicWorkMetadataFromDLsite,
  scrapeWorkMetadataFromDLsite,
  scrapeWorkMetadataFromDLsiteJson,
} from '../../scraper/dlsite';

describe('normalizeDlsiteImageUrl', () => {
  it('keeps absolute http(s) URLs unchanged', () => {
    expect(normalizeDlsiteImageUrl('https://img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg'))
      .toBe('https://img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg');
  });

  it('normalizes protocol-relative URLs to https', () => {
    expect(normalizeDlsiteImageUrl('//img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg'))
      .toBe('https://img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg');
  });

  it('normalizes root-relative URLs using the provided base URL', () => {
    expect(normalizeDlsiteImageUrl('/modpub/images2/work/doujin/RJ123456_img_main.jpg', 'https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html'))
      .toBe('https://www.dlsite.com/modpub/images2/work/doujin/RJ123456_img_main.jpg');
  });

  it('returns null for unsupported values', () => {
    expect(normalizeDlsiteImageUrl('RJ123456_img_main.jpg')).toBeNull();
    expect(normalizeDlsiteImageUrl(undefined)).toBeNull();
  });
});

describe('scrapeWorkMetadataFromDLsite', () => {
  beforeEach(() => {
    dlsiteMocks.retryGet.mockReset();
    dlsiteMocks.scrapeHvdb.mockReset();
  });

  it('does not repeat HVDB voice-actor hydration during a cover-only JSON fallback', async () => {
    dlsiteMocks.retryGet.mockImplementation(async (url: string) => {
      if (url.includes('/product/info/ajax')) return { data: {} };
      if (url.includes('/product.json')) {
        return {
          data: [{
            work_image_main: '//img.dlsite.jp/RJ123456_img_main.jpg',
            genres: [{ id: 123, name: 'Test tag' }],
          }],
        };
      }
      return {
        data: `
          <html>
            <head><meta property="og:title" content="Test work" /></head>
            <body>
              <table id="work_outline"><tbody>
                <tr><th>ジャンル</th><td><div><a href="/genre/123">Test tag</a></div></td></tr>
              </tbody></table>
            </body>
          </html>
        `,
      };
    });
    dlsiteMocks.scrapeHvdb.mockResolvedValue({
      tags: [],
      vas: [{ id: 'hvdb-va', name: 'Test VA' }],
    });

    const metadata = await scrapeWorkMetadataFromDLsite(123456, 'ja-jp');

    expect(metadata.cover_url).toBe('https://img.dlsite.jp/RJ123456_img_main.jpg');
    expect(metadata.vas).toEqual([{ id: 'hvdb-va', name: 'Test VA' }]);
    expect(dlsiteMocks.scrapeHvdb).toHaveBeenCalledTimes(1);
  });

  it('keeps valid DLsite metadata when optional HVDB enrichment fails', async () => {
    dlsiteMocks.retryGet.mockImplementation(async (url: string) => {
      if (url.includes('/product/info/ajax')) return { data: {} };
      return {
        data: `
          <html>
            <head>
              <meta property="og:title" content="Test work" />
              <meta property="og:image" content="https://img.dlsite.jp/RJ123456_img_main.jpg" />
            </head>
            <body>
              <table id="work_outline"><tbody>
                <tr><th>ジャンル</th><td><div><a href="/genre/123">Test tag</a></div></td></tr>
              </tbody></table>
            </body>
          </html>
        `,
      };
    });
    dlsiteMocks.scrapeHvdb.mockRejectedValue(new Error('HVDB unavailable'));

    const metadata = await scrapeWorkMetadataFromDLsite(123456, 'ja-jp');

    expect(metadata.title).toBe('Test work');
    expect(metadata.tags).toEqual([{ id: 123, name: 'Test tag' }]);
    expect(metadata.vas).toEqual([]);
  });

  it.each([true, false])('extracts complete HTML metadata with tbody=%s', async (withTbody) => {
    dlsiteMocks.retryGet.mockImplementation(async (url: string) => {
      if (url.includes('/product/info/ajax')) return { data: {} };
      return {
        data: `
          <html>
            <head>
              <meta property="og:title" content="Test &amp; work [Circle] | DLsite" />
              <meta property="og:image" content="//img.dlsite.jp/RJ123456_img_main.jpg" />
            </head>
            <body>
              <span class="maker_name"><a href="/maker/profile/=/maker_id/RG12345.html">Test Circle</a></span>
              <table id="work_outline">${withTbody ? '<tbody>' : ''}
                <tr><th>年齢指定</th><td><span>R-18</span></td></tr>
                <tr><th>販売日</th><td>2026年09月12日</td></tr>
                <tr><th>シリーズ名</th><td><a href="/series/id/SRI1234567890">Test Series</a></td></tr>
                <tr><th>ジャンル</th><td><div><a href="/genre/123">Voice &amp; Audio</a></div></td></tr>
                <tr><th>声優</th><td><a href="/voice/1">Test VA</a></td></tr>
              ${withTbody ? '</tbody>' : ''}</table>
            </body>
          </html>
        `,
      };
    });

    const metadata = await scrapeWorkMetadataFromDLsite(123456, 'ja-jp');

    expect(metadata).toMatchObject({
      title: 'Test & work',
      cover_url: 'https://img.dlsite.jp/RJ123456_img_main.jpg',
      circle: { id: 12345, name: 'Test Circle' },
      nsfw: true,
      ageRating: 'r18',
      release: '2026-09-12',
      series: { id: 1234567890, name: 'Test Series' },
      tags: [{ id: 123, name: 'Voice & Audio' }],
      vas: [{ name: 'Test VA' }],
    });
    expect(dlsiteMocks.scrapeHvdb).not.toHaveBeenCalled();
  });

  it.each([
    ['全年齢', 'sfw', false],
    ['R-15', 'r15', false],
    ['R-18', 'r18', true],
  ])('maps DLsite HTML rating %s', async (label, ageRating, nsfw) => {
    dlsiteMocks.retryGet.mockImplementation(async (url: string) => ({
      data: url.includes('/product/info/ajax') ? {} : `
        <meta property="og:title" content="Rating fixture" />
        <meta property="og:image" content="https://img.dlsite.jp/fixture.jpg" />
        <table id="work_outline">
          <tr><th>年齢指定</th><td><span>${label}</span></td></tr>
          <tr><th>ジャンル</th><td><div><a href="/genre/123">Fixture</a></div></td></tr>
          <tr><th>声優</th><td><a href="/voice/1">Fixture VA</a></td></tr>
        </table>`,
    }));
    expect(await scrapeWorkMetadataFromDLsite(123456)).toMatchObject({ ageRating, nsfw });
  });

  it.each([
    [1, 'sfw', false],
    [2, 'r15', false],
    [3, 'r18', true],
  ])('maps DLsite JSON age_category %i', async (category, ageRating, nsfw) => {
    dlsiteMocks.retryGet.mockImplementation(async (url: string) => ({
      data: url.includes('/product.json')
        ? [{ age_category: category, genres: [{ id: 123, name: 'Fixture' }], creaters: { voice_by: [{ id: 1, name: 'VA' }] } }]
        : {},
    }));
    expect(await scrapeWorkMetadataFromDLsiteJson(123456)).toMatchObject({ ageRating, nsfw });
  });

  it('finds the translated edition that supplies the cover', async () => {
    dlsiteMocks.retryGet.mockResolvedValue({
      data: `
        <div class="work_edition_linklist type_trans">
          <a class="work_edition_linklist_item" href="/product_id/RJ123456.html">Original</a>
          <a class="work_edition_linklist_item" href="/product_id/RJ87654321.html">Translation</a>
        </div>
        <img srcset="//img.dlsite.jp/RJ123456_img_main.webp" />
      `,
    });

    await expect(scrapeCoverIdForTranslatedWorkFromDLsite(87654321, 'ja-jp')).resolves.toEqual({
      coverFromId: '123456',
      isNoImgMain: false,
    });
  });

  it('omits absent dynamic statistics instead of manufacturing zero values', async () => {
    dlsiteMocks.retryGet.mockResolvedValue({
      data: { RJ123456: { review_count: '2' } },
    });

    await expect(scrapeDynamicWorkMetadataFromDLsite(123456)).resolves.toEqual({
      review_count: 2,
    });
  });

  it('preserves explicit zero and null dynamic statistics', async () => {
    dlsiteMocks.retryGet.mockResolvedValue({
      data: {
        RJ123456: {
          dl_count: 0,
          rate_average_2dp: 0,
          rate_count: 0,
          rate_count_detail: null,
        },
      },
    });

    await expect(scrapeDynamicWorkMetadataFromDLsite(123456)).resolves.toEqual({
      dl_count: '0',
      rate_average_2dp: 0,
      rate_count: 0,
      rate_count_detail: null,
    });
  });
});
