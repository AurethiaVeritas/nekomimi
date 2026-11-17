import { createCollection, getCollection, listCollections, searchCollectionWorks, searchWorkFacets, searchWorks, upsertWork } from '../../server/db';

describe('Consistent metadata filtering', () => {
  const workId = 920001;

  beforeAll(async () => {
    await upsertWork({
      id: workId,
      rjcode: String(workId),
      title: 'ÉCOUTE Audit 音声',
      circle: { name: ' \tCercle ÉTÉ\t ' },
      tags: [{ name: ' ÉTÉ ' }, { name: 'ÉTÉ' }, { name: 'Sleep' }, { name: 'Sleep' }],
      vas: [{ name: 'ΆΝΝΑ' }, { name: 'ΆΝΝΑ' }],
    });
  });

  it.each([
    { q: 'écoute' },
    { circles: ['Cercle été'] },
    { tags: ['été'] },
    { vas: ['άννα'] },
  ])('matches normalized Unicode metadata for %j', async filter => {
    const result = await searchWorks(filter);
    expect(result.items.map(work => work.id)).toEqual([workId]);
    expect(result.items[0].title).toBe('ÉCOUTE Audit 音声');
  });

  it('counts each work once per normalized tag or voice actor', async () => {
    const facets = await searchWorkFacets({ q: 'audit' });
    expect(facets.tags).toEqual(expect.arrayContaining([
      { name: 'Sleep', count: 1 },
      { name: 'ÉTÉ', count: 1 },
    ]));
    expect(facets.tags).toHaveLength(2);
    expect(facets.vas).toHaveLength(1);
    expect(facets.vas[0].count).toBe(1);
  });

  it.each(['and', 'or'] as const)('agrees about membership and results for a Unicode smart collection (%s)', async match => {
    const collection = await createCollection(1, {
      name: `Unicode audit ${match}`, type: 'smart', match,
      ageRatings: ['sfw', 'r15', 'r18'], tags: ['été'],
    });
    const membership = await getCollection(1, collection.id, workId);
    const works = await searchCollectionWorks(1, collection.id);
    const listed = (await listCollections(1, workId)).find(item => item.id === collection.id);
    expect(membership?.containsWork).toBe(true);
    expect(membership?.workCount).toBe(1);
    expect(listed).toMatchObject({ containsWork: true, workCount: 1 });
    expect(works?.items.map(work => work.id)).toEqual([workId]);
  });
});
