import type { DbWork } from '../../server/db';
import type { ScrapedWorkMetadata } from '../../scraper/types';
import { mergeScrapedMetadata } from '../../server/metadataMerge';

describe('mergeScrapedMetadata', () => {
  function makeExistingWork(): DbWork {
    return {
      id: 123456,
      rjcode: '123456',
      title: 'Existing Title',
      circle: { name: 'Existing Circle' },
      nsfw: true,
      ageRating: 'r18',
      release: '2024-01-01',
      series: { name: 'Existing Series' },
      tags: [{ id: 1, name: 'Existing Tag' }],
      vas: [{ id: 'va1', name: 'Existing VA' }],
      stats: {
        dl_count: 999,
        rate_average_2dp: 4.6,
        rate_count: 123,
        review_count: 7,
        rank: [{ term: 'daily', category: 'voice', rank: 1, rank_date: '2024-01-01' }],
        rate_count_detail: { 5: 100, 4: 20 },
      },
      base_dir: '/library/RJ123456',
      cover_path: '/cover/RJ123456.jpg',
      media: [{ filename: '01.mp3', filepath: '/library/RJ123456/01.mp3', mime: 'audio/mpeg' }],
    };
  }

  it('preserves existing metadata when scraped fields are empty or missing', () => {
    const existing = makeExistingWork();
    const scraped: ScrapedWorkMetadata = {
      tags: [],
      vas: [],
    };

    const merged = mergeScrapedMetadata(scraped, existing);

    expect(merged.title).toBe('Existing Title');
    expect(merged.circle.name).toBe('Existing Circle');
    expect(merged.nsfw).toBe(true);
    expect(merged.ageRating).toBe('r18');
    expect(merged.release).toBe('2024-01-01');
    expect(merged.series?.name).toBe('Existing Series');
    expect(merged.tags).toEqual(existing.tags);
    expect(merged.vas).toEqual(existing.vas);
    expect(merged.stats).toEqual(existing.stats);
  });

  it('applies scraped values when they are present, including false/zero values', () => {
    const existing = makeExistingWork();
    const scraped: ScrapedWorkMetadata = {
      title: 'New Title',
      circle: { name: 'New Circle' },
      nsfw: false,
      release: '2025-02-03',
      series: { name: 'New Series' },
      tags: [{ id: 2, name: 'New Tag' }],
      vas: [{ id: 'va2', name: 'New VA' }],
      dl_count: '0',
      rate_average_2dp: 0,
      rate_count: 0,
      review_count: 0,
      rate_count_detail: null,
    };

    const merged = mergeScrapedMetadata(scraped, existing);

    expect(merged.title).toBe('New Title');
    expect(merged.circle.name).toBe('New Circle');
    expect(merged.nsfw).toBe(false);
    expect(merged.ageRating).toBe('sfw');
    expect(merged.release).toBe('2025-02-03');
    expect(merged.series?.name).toBe('New Series');
    expect(merged.tags).toEqual(scraped.tags);
    expect(merged.vas).toEqual(scraped.vas);
    expect(merged.stats.dl_count).toBe(0);
    expect(merged.stats.rate_average_2dp).toBe(0);
    expect(merged.stats.rate_count).toBe(0);
    expect(merged.stats.review_count).toBe(0);
    expect(merged.stats.rate_count_detail).toBeNull();
  });

  it('keeps an explicit R-15 rating distinct from the legacy boolean', () => {
    const merged = mergeScrapedMetadata({ ageRating: 'r15', nsfw: false, tags: [], vas: [] }, makeExistingWork());
    expect(merged).toMatchObject({ ageRating: 'r15', nsfw: false });
  });
});
