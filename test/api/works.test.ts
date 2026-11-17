import request from 'supertest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { bootstrapTestUser } from '../helpers/auth';

describe('Works API', () => {
  let authCookie: string | null;

  beforeAll(async () => {
    // Bootstrap a test user for authenticated requests
    const auth = await bootstrapTestUser(request(app));
    authCookie = auth.cookie;
  });

  describe('GET /api/works', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/works');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return an empty paginated result when no works exist', async () => {
      const res = await request(app)
        .get('/api/works')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        page: 1,
        pageSize: 24,
        total: 0,
        totalPages: 0,
        items: [],
        hasNext: false,
        hasPrev: false,
      });
    });
  });

  describe('GET /api/work/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/work/RJ123456');

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent work', async () => {
      const res = await request(app)
        .get('/api/work/RJ999999')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/circles', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/circles');

      expect(res.status).toBe(401);
    });

    it('should return empty array when no circles exist', async () => {
      const res = await request(app)
        .get('/api/circles')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  describe('GET /api/works/facets', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/works/facets');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return empty facets when no works exist', async () => {
      const res = await request(app)
        .get('/api/works/facets')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        circles: [],
        tags: [],
        vas: [],
      });
    });
  });

  describe('Works pagination and aggregation', () => {
    beforeAll(async () => {
      const baseStats = { dl_count: 0, rate_average_2dp: 0, rate_count: 0, review_count: 0, rank: [], rate_count_detail: null };
      await upsertWork({
        id: 111,
        rjcode: '000111',
        title: 'Bedtime Whispers',
        circle: { name: 'Circle Alpha' },
        nsfw: false,
        release: '2024-01-02',
        tags: [{ name: 'Relaxing' }],
        vas: [{ name: 'VA One' }],
        stats: baseStats,
        media: [],
      });
      await upsertWork({
        id: 222,
        rjcode: '000222',
        title: 'Midnight Secrets',
        circle: { name: 'Circle Beta' },
        nsfw: true,
        release: '2024-03-04',
        tags: [{ name: 'Spicy' }],
        vas: [{ name: 'VA Two' }],
        stats: baseStats,
        media: [],
      });
      await upsertWork({
        id: 333,
        rjcode: '000333',
        title: 'Afternoon Story',
        circle: { name: 'Circle Gamma' },
        ageRating: 'r15',
        release: '2024-02-03',
        tags: [{ name: 'Relaxing' }],
        vas: [{ name: 'VA Three' }],
        stats: baseStats,
        media: [],
      });
    });

    it('returns paginated payload without facets metadata', async () => {
      const res = await request(app)
        .get('/api/works')
        .query({ page: 1, pageSize: 1, nsfw: 'sfw', tag: 'Relaxing' })
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(1);
      expect(res.body.total).toBe(1);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].circle.name).toBe('Circle Alpha');
      expect(res.body.facets).toBeUndefined();
    });

    it('returns filtered facets from the dedicated endpoint', async () => {
      const res = await request(app)
        .get('/api/works/facets')
        .query({ nsfw: 'sfw', tag: 'Relaxing' })
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body.tags.some((t: { name: string }) => t.name === 'Relaxing')).toBe(true);
      expect(res.body.circles).toEqual([{ name: 'Circle Alpha', count: 1 }]);
      expect(res.body.vas).toEqual([{ name: 'VA One', count: 1 }]);
    });

    it('filters works, facets, and circles by exact age rating while retaining the NSFW alias', async () => {
      const r15 = await request(app).get('/api/works').query({ nsfw: 'r15' }).set('Cookie', authCookie || '');
      expect(r15.body.items.map((work: { id: number }) => work.id)).toEqual([333]);
      expect(r15.body.items[0]).toMatchObject({ ageRating: 'r15', nsfw: false });

      const facets = await request(app).get('/api/works/facets').query({ nsfw: 'r15' }).set('Cookie', authCookie || '');
      expect(facets.body.circles).toEqual([{ name: 'Circle Gamma', count: 1 }]);

      const circles = await request(app).get('/api/circles').query({ nsfw: 'r15' }).set('Cookie', authCookie || '');
      expect(circles.body.map((circle: { name: string }) => circle.name)).toEqual(['Circle Gamma']);

      const legacy = await request(app).get('/api/works').query({ nsfw: 'nsfw' }).set('Cookie', authCookie || '');
      expect(legacy.body.items.map((work: { id: number }) => work.id)).toEqual([222]);
    });

    it('combines independent age rating selections across works, facets, and circles', async () => {
      for (const [ratings, expectedIds] of [
        [['sfw', 'r15'], [111, 333]],
        [['r15', 'r18'], [222, 333]],
        [['sfw', 'r18'], [111, 222]],
        [['sfw', 'r15', 'r18'], [111, 222, 333]],
        [['none'], []],
      ] as const) {
        const query = ratings.map(rating => `ageRating=${rating}`).join('&');
        const works = await request(app).get(`/api/works?${query}`).set('Cookie', authCookie || '');
        expect(works.status).toBe(200);
        expect(works.body.items.map((work: { id: number }) => work.id).sort()).toEqual([...expectedIds].sort());
        const facets = await request(app).get(`/api/works/facets?${query}`).set('Cookie', authCookie || '');
        expect(facets.status).toBe(200);
        const circles = await request(app).get(`/api/circles?${query}`).set('Cookie', authCookie || '');
        expect(circles.status).toBe(200);
        expect(facets.body.circles.length).toBe(expectedIds.length);
        expect(circles.body.length).toBe(expectedIds.length);
      }
      const invalid = await request(app).get('/api/works?ageRating=unknown').set('Cookie', authCookie || '');
      expect(invalid.status).toBe(400);
    });

    it('aggregates circles with counts and ordering', async () => {
      const res = await request(app)
        .get('/api/circles')
        .query({ sort: 'count_desc' })
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const alpha = res.body.find((c: { name: string }) => c.name === 'Circle Alpha');
      expect(alpha).toBeDefined();
      expect(alpha.count).toBe(1);
      expect(alpha.newestWorkId).toBe(111);
    });
  });
});
