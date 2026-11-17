import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

describe('age rating migration', () => {
  it('maps old NSFW works to R-18 and preserves collection memberships', async () => {
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const oldDb = new SQL.Database();
    oldDb.exec(`
      CREATE TABLE works (
        id INTEGER PRIMARY KEY, rjcode TEXT NOT NULL, title TEXT, circle_name TEXT,
        nsfw INTEGER DEFAULT 0, tags_json TEXT, vas_json TEXT
      );
      INSERT INTO works (id, rjcode, title, nsfw, tags_json, vas_json) VALUES
        (998001, '998001', 'Old SFW', 0, '[{"name":"Fixture"}]', '[]'),
        (998002, '998002', 'Old NSFW', 1, '[{"name":"Fixture"}]', '[]');
      CREATE TABLE collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER NOT NULL,
        name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('manual', 'smart')),
        match_logic TEXT NOT NULL DEFAULT 'and' CHECK (match_logic IN ('and', 'or')),
        content_filter TEXT NOT NULL DEFAULT 'all' CHECK (content_filter IN ('sfw', 'all', 'nsfw')),
        tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT, updated_at TEXT
      );
      INSERT INTO collections (id, owner_user_id, name, type, content_filter, tags_json) VALUES
        (1, 1, 'Old smart', 'smart', 'nsfw', '["Fixture"]'),
        (2, 1, 'Old manual', 'manual', 'all', '[]');
      CREATE TABLE collection_works (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        added_at TEXT, PRIMARY KEY (collection_id, work_id)
      );
      INSERT INTO collection_works (collection_id, work_id) VALUES (2, 998001);
    `);
    const file = path.join(process.env.DATA_DIR || '', 'nekomimi.db');
    fs.writeFileSync(file, Buffer.from(oldDb.export()));
    oldDb.close();

    const { getWork, listCollections, createCollection } = await import('../../server/db.js');
    expect(await getWork(998001)).toMatchObject({ ageRating: 'sfw', nsfw: false });
    expect(await getWork(998002)).toMatchObject({ ageRating: 'r18', nsfw: true });
    expect(await listCollections(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Old smart', contentFilter: 'r18', ageRatings: ['r18'], workCount: 1 }),
      expect.objectContaining({ name: 'Old manual', ageRatings: ['sfw', 'r15', 'r18'], workCount: 1 }),
    ]));
    expect(await createCollection(1, {
      name: 'New R-15', type: 'smart', match: 'and', ageRatings: ['r15'], tags: ['Fixture'],
    })).toMatchObject({ contentFilter: 'r15', ageRatings: ['r15'] });
  });
});
