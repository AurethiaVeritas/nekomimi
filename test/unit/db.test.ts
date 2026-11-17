import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { createCollection, deleteCollection, deleteWork, flushDatabase, getCollection, getWork, listWorks, setCollectionWorkMembership, upsertWork } from '../../server/db';

const baseStats = {
  dl_count: 0,
  rate_average_2dp: 0,
  rate_count: 0,
  review_count: 0,
  rank: [],
  rate_count_detail: null,
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('db work updates', () => {
  it('keeps foreign-key cascades enabled after saves so reimporting a deleted work does not restore membership', async () => {
    const work = { id: 910010, rjcode: '910010', title: 'Deleted member' };
    await upsertWork(work);
    const collection = await createCollection(1, { name: 'Cascade work fixture', type: 'manual', match: 'and', ageRatings: ['sfw'], tags: [] });
    await setCollectionWorkMembership(1, collection.id, work.id, true);
    expect((await getCollection(1, collection.id))?.workCount).toBe(1);
    await deleteWork(work.id);
    await upsertWork(work);
    expect(await getCollection(1, collection.id, work.id)).toMatchObject({ workCount: 0, containsWork: false });
  });

  it('removes collection membership rows from persisted storage after deletion', async () => {
    await upsertWork({ id: 910011, rjcode: '910011', title: 'Collection reuse member' });
    const input = { name: 'Cascade collection fixture', type: 'manual' as const, match: 'and' as const, ageRatings: [], tags: [] };
    const deleted = await createCollection(1, input);
    await setCollectionWorkMembership(1, deleted.id, 910011, true);
    await deleteCollection(1, deleted.id);
    await flushDatabase();
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const snapshot = new SQL.Database(fs.readFileSync(path.join(process.env.DATA_DIR!, 'nekomimi.db')));
    try {
      const statement = snapshot.prepare('SELECT COUNT(*) AS count FROM collection_works WHERE collection_id = ?');
      try {
        statement.bind([deleted.id]);
        statement.step();
        expect(statement.getAsObject().count).toBe(0);
      } finally { statement.free(); }
    } finally { snapshot.close(); }
    const replacement = await createCollection(1, input);
    expect(replacement.workCount).toBe(0);
  });

  it('rolls back the work row when its media replacement fails', async () => {
    const workId = 910003;
    const invalidFilepath = Symbol('invalid filepath') as unknown as string;

    await expect(upsertWork({
      id: workId,
      rjcode: String(workId),
      title: 'Atomic Work',
      circle: { name: 'Test Circle' },
      nsfw: false,
      release: '2024-01-03',
      tags: [],
      vas: [],
      stats: baseStats,
      media: [{ filename: 'broken.mp3', filepath: invalidFilepath, mime: 'audio/mpeg' }],
    })).rejects.toThrow();

    await expect(getWork(workId)).resolves.toBeNull();
  });

  it('preserves list order when requested by metadata-only updates', async () => {
    const olderId = 910001;
    const newerId = 910002;

    await upsertWork({
      id: olderId,
      rjcode: '910001',
      title: 'Older Work',
      circle: { name: 'Test Circle' },
      nsfw: false,
      release: '2024-01-01',
      tags: [],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await delay(1100);
    await upsertWork({
      id: newerId,
      rjcode: '910002',
      title: 'Newer Work',
      circle: { name: 'Test Circle' },
      nsfw: false,
      release: '2024-01-02',
      tags: [],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await delay(1100);

    await upsertWork({
      id: olderId,
      rjcode: '910001',
      title: 'Older Work Refreshed',
      circle: { name: 'Test Circle' },
      nsfw: false,
      release: '2024-01-01',
      tags: [{ name: 'Updated Tag' }],
      vas: [],
      stats: baseStats,
      media: [],
    }, { preserveUpdatedAt: true });

    const relevantIds = (await listWorks())
      .filter(work => work.id === olderId || work.id === newerId)
      .map(work => work.id);

    expect(relevantIds).toEqual([newerId, olderId]);
  });
});
