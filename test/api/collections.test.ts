import request from 'supertest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { bootstrapTestUser } from '../helpers/auth';

const baseStats = {
  dl_count: 0,
  rate_average_2dp: 0,
  rate_count: 0,
  review_count: 0,
  rank: [],
  rate_count_detail: null,
};

describe('Collections API', () => {
  let authCookie = '';

  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app), 'collections-user');
    authCookie = auth.cookie || '';

    await upsertWork({
      id: 700001,
      rjcode: '700001',
      title: 'Sleep and Relax',
      circle: { name: 'Collection Circle' },
      nsfw: false,
      release: '2025-01-01',
      tags: [{ name: 'Sleep' }, { name: 'Relaxing' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await upsertWork({
      id: 700002,
      rjcode: '700002',
      title: 'Sleep Only',
      circle: { name: 'Collection Circle' },
      nsfw: false,
      release: '2025-01-02',
      tags: [{ name: 'Sleep' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await upsertWork({
      id: 700003,
      rjcode: '700003',
      title: 'Relaxing Only',
      circle: { name: 'Collection Circle' },
      nsfw: false,
      release: '2025-01-03',
      tags: [{ name: 'Relaxing' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await upsertWork({
      id: 700004,
      rjcode: '700004',
      title: 'SFW Rating Fixture',
      circle: { name: 'Collection Circle' },
      nsfw: false,
      release: '2025-02-01',
      tags: [{ name: 'Rating Fixture' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await upsertWork({
      id: 700005,
      rjcode: '700005',
      title: 'NSFW Rating Fixture',
      circle: { name: 'Collection Circle' },
      nsfw: true,
      release: '2025-02-02',
      tags: [{ name: 'Rating Fixture' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
    await upsertWork({
      id: 700006,
      rjcode: '700006',
      title: 'R-15 Rating Fixture',
      circle: { name: 'Collection Circle' },
      ageRating: 'r15',
      release: '2025-02-03',
      tags: [{ name: 'Rating Fixture' }],
      vas: [],
      stats: baseStats,
      media: [],
    });
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/collections');
    expect(res.status).toBe(401);
  });

  it('creates a manual collection and manages work membership', async () => {
    const created = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'Favorites', type: 'manual' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Favorites', type: 'manual', contentFilter: 'all', workCount: 0 });

    const added = await request(app)
      .put(`/api/collections/${created.body.id}/works/700001`)
      .set('Cookie', authCookie)
      .send({ included: true });

    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ workCount: 1, containsWork: true });

    const works = await request(app)
      .get(`/api/collections/${created.body.id}/works`)
      .set('Cookie', authCookie);

    expect(works.status).toBe(200);
    expect(works.body.total).toBe(1);
    expect(works.body.items.map((work: { id: number }) => work.id)).toEqual([700001]);

    const memberships = await request(app)
      .get('/api/collections')
      .query({ workId: 700001 })
      .set('Cookie', authCookie);

    const favorite = memberships.body.find((collection: { id: number }) => collection.id === created.body.id);
    expect(favorite.containsWork).toBe(true);

    const removed = await request(app)
      .put(`/api/collections/${created.body.id}/works/700001`)
      .set('Cookie', authCookie)
      .send({ included: false });

    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ workCount: 0, containsWork: false });
  });

  it('evaluates smart collections with AND and OR tag logic and updates live', async () => {
    const allTags = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'All Tags', type: 'smart', match: 'and', tags: ['Sleep', 'Relaxing'] });
    const anyTag = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'Any Tag', type: 'smart', match: 'or', tags: ['Sleep', 'Relaxing'] });

    expect(allTags.status).toBe(201);
    expect(anyTag.status).toBe(201);
    expect(allTags.body.workCount).toBe(1);
    expect(anyTag.body.workCount).toBe(3);

    const rejectedMembership = await request(app)
      .put(`/api/collections/${allTags.body.id}/works/700002`)
      .set('Cookie', authCookie)
      .send({ included: true });
    expect(rejectedMembership.status).toBe(400);

    await upsertWork({
      id: 700002,
      rjcode: '700002',
      title: 'Sleep Only, Retagged',
      circle: { name: 'Collection Circle' },
      nsfw: false,
      release: '2025-01-02',
      tags: [{ name: 'Sleep' }, { name: 'Relaxing' }],
      vas: [],
      stats: baseStats,
      media: [],
    });

    const refreshed = await request(app)
      .get(`/api/collections/${allTags.body.id}`)
      .set('Cookie', authCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.workCount).toBe(2);
  });

  it('filters smart collections by all three age ratings', async () => {
    const allContent = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'All Content', type: 'smart', tags: ['Rating Fixture'] });
    const sfwOnly = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'SFW Only', type: 'smart', contentFilter: 'sfw', tags: ['Rating Fixture'] });
    const nsfwOnly = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'NSFW Only', type: 'smart', contentFilter: 'nsfw', tags: ['Rating Fixture'] });
    const r15Only = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'R-15 Only', type: 'smart', contentFilter: 'r15', tags: ['Rating Fixture'] });

    expect(allContent.status).toBe(201);
    expect(allContent.body).toMatchObject({ contentFilter: 'all', workCount: 3 });
    expect(sfwOnly.body).toMatchObject({ contentFilter: 'sfw', workCount: 1 });
    expect(nsfwOnly.body).toMatchObject({ contentFilter: 'r18', workCount: 1 });
    expect(r15Only.body).toMatchObject({ contentFilter: 'r15', workCount: 1 });

    const sfwWorks = await request(app)
      .get(`/api/collections/${sfwOnly.body.id}/works`)
      .set('Cookie', authCookie);
    const nsfwWorks = await request(app)
      .get(`/api/collections/${nsfwOnly.body.id}/works`)
      .set('Cookie', authCookie);
    const r15Works = await request(app)
      .get(`/api/collections/${r15Only.body.id}/works`)
      .set('Cookie', authCookie);
    expect(sfwWorks.body.items.map((work: { id: number }) => work.id)).toEqual([700004]);
    expect(nsfwWorks.body.items.map((work: { id: number }) => work.id)).toEqual([700005]);
    expect(r15Works.body.items.map((work: { id: number }) => work.id)).toEqual([700006]);

    const sfwMemberships = await request(app)
      .get('/api/collections')
      .query({ workId: 700004 })
      .set('Cookie', authCookie);
    expect(sfwMemberships.body.find((collection: { id: number }) => collection.id === sfwOnly.body.id).containsWork).toBe(true);
    expect(sfwMemberships.body.find((collection: { id: number }) => collection.id === nsfwOnly.body.id).containsWork).toBe(false);

    const updated = await request(app)
      .put(`/api/collections/${allContent.body.id}`)
      .set('Cookie', authCookie)
      .send({ contentFilter: 'nsfw' });
    expect(updated.body).toMatchObject({ contentFilter: 'r18', workCount: 1 });
  });

  it('stores rating toggle combinations and updates smart collection membership', async () => {
    const combinations: Array<[string, string[], number]> = [
      ['SFW and R-15', ['sfw', 'r15'], 2],
      ['R-15 and R-18', ['r15', 'r18'], 2],
      ['SFW and R-18', ['sfw', 'r18'], 2],
      ['All ratings', ['sfw', 'r15', 'r18'], 3],
      ['No ratings', [], 0],
    ];
    for (const [name, ageRatings, workCount] of combinations) {
      const created = await request(app).post('/api/collections').set('Cookie', authCookie)
        .send({ name, type: 'smart', ageRatings, tags: ['Rating Fixture'] });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ ageRatings, workCount });
      const works = await request(app).get(`/api/collections/${created.body.id}/works`).set('Cookie', authCookie);
      expect(works.body.items).toHaveLength(workCount);
      const changed = await request(app).put(`/api/collections/${created.body.id}`).set('Cookie', authCookie)
        .send({ ageRatings: ['r18'] });
      expect(changed.body).toMatchObject({ ageRatings: ['r18'], contentFilter: 'r18', workCount: 1 });
    }
    const invalid = await request(app).post('/api/collections').set('Cookie', authCookie)
      .send({ name: 'Invalid ratings', type: 'smart', ageRatings: ['unknown'], tags: ['Rating Fixture'] });
    expect(invalid.status).toBe(400);
  });

  it('validates smart rules, enforces unique names, and isolates owners', async () => {
    const invalid = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'No Rules', type: 'smart', tags: [] });
    expect(invalid.status).toBe(400);

    const invalidContent = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'Invalid Content', type: 'smart', contentFilter: 'sometimes', tags: ['Sleep'] });
    expect(invalidContent.status).toBe(400);

    const duplicate = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'favorites', type: 'manual' });
    expect(duplicate.status).toBe(409);

    const otherCookie = 'auth=forged-user-token';
    const otherOwner = await request(app)
      .get('/api/collections')
      .set('Cookie', otherCookie);
    expect(otherOwner.status).toBe(401);
  });

  it('updates and deletes a collection', async () => {
    const created = await request(app)
      .post('/api/collections')
      .set('Cookie', authCookie)
      .send({ name: 'Temporary', type: 'manual' });

    const updated = await request(app)
      .put(`/api/collections/${created.body.id}`)
      .set('Cookie', authCookie)
      .send({ name: 'Weekend Queue' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Weekend Queue');

    const deleted = await request(app)
      .delete(`/api/collections/${created.body.id}`)
      .set('Cookie', authCookie);
    expect(deleted.status).toBe(200);

    const missing = await request(app)
      .get(`/api/collections/${created.body.id}`)
      .set('Cookie', authCookie);
    expect(missing.status).toBe(404);
  });
});
