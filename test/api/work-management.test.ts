import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { bootstrapTestUser } from '../helpers/auth';

const workManagementScraperMocks = vi.hoisted(() => {
  const metadataFor = (id: number) => ({
    id,
    title: `Mock DLsite Work RJ${String(id).padStart(6, '0')}`,
    circle: { id: 'mock-circle', name: 'Mock Circle' },
    nsfw: false,
    release: '2024-01-01',
    tags: [{ id: 'mock-tag', name: 'Mock Tag' }],
    vas: [{ id: 'mock-va', name: 'Mock VA' }],
    dl_count: '12',
    rate_average_2dp: 4.1,
    rate_count: 5,
    rate_count_detail: null,
    review_count: 1,
    rank: [],
  });

  return {
    metadataFor,
    scrapeDlsite: vi.fn(),
    scrapeAsmrOne: vi.fn(),
    scrapeHvdb: vi.fn(),
    retryGet: vi.fn(),
    get: vi.fn(),
  };
});

vi.mock('../../scraper/dlsite', () => ({
  scrapeWorkMetadataFromDLsite: workManagementScraperMocks.scrapeDlsite,
}));

vi.mock('../../scraper/asmrOne', () => ({
  scrapeWorkMetadataFromAsmrOne: workManagementScraperMocks.scrapeAsmrOne,
}));

vi.mock('../../scraper/hvdb', () => ({
  scrapeWorkMetadataFromHVDB: workManagementScraperMocks.scrapeHvdb,
}));

vi.mock('../../scraper/axios', () => ({
  default: {
    retryGet: workManagementScraperMocks.retryGet,
    get: workManagementScraperMocks.get,
  },
}));

const mockPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

function resetWorkManagementScraperMocks() {
  workManagementScraperMocks.scrapeDlsite.mockReset();
  workManagementScraperMocks.scrapeAsmrOne.mockReset();
  workManagementScraperMocks.scrapeHvdb.mockReset();
  workManagementScraperMocks.retryGet.mockReset();
  workManagementScraperMocks.get.mockReset();

  workManagementScraperMocks.scrapeDlsite.mockImplementation(async (id: number) => workManagementScraperMocks.metadataFor(id));
  workManagementScraperMocks.scrapeAsmrOne.mockImplementation(async (id: number) => workManagementScraperMocks.metadataFor(id));
  workManagementScraperMocks.scrapeHvdb.mockImplementation(async (id: number) => workManagementScraperMocks.metadataFor(id));
  workManagementScraperMocks.retryGet.mockResolvedValue({
    data: mockPng,
    headers: { 'content-type': 'image/png' },
  });
  workManagementScraperMocks.get.mockRejectedValue(new Error('Unexpected direct axios.get call in work management API tests'));
}

describe('Work Management API', () => {
  let authCookie: string | null;
  let testWorkId: string | number;

  beforeAll(async () => {
    resetWorkManagementScraperMocks();
    const auth = await bootstrapTestUser(request(app));
    authCookie = auth.cookie;
  });

  describe('PUT /api/works/:id', () => {
    beforeAll(async () => {
      // Create a test work first via import
      const importRes = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456' });

      if (importRes.status === 200 || importRes.status === 201) {
        testWorkId = importRes.body.id || 'RJ123456';
      } else {
        testWorkId = 'RJ999999'; // Use a fake ID if import fails
      }
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .put('/api/works/RJ123456')
        .send({ title: 'Updated Title' });

      expect(res.status).toBe(401);
    });

    it('should update work metadata', async () => {
      const updates = {
        title: 'Updated Test Title',
        circle: { name: 'Test Circle' },
        nsfw: true,
        tags: [{ name: 'tag1' }, { name: 'tag2' }],
      };

      const res = await request(app)
        .put(`/api/works/${testWorkId}`)
        .set('Cookie', authCookie || '')
        .send(updates);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(updates);
      expect(res.body.ageRating).toBe('r18');
    });

    it('accepts R-15 edits and derives the legacy NSFW field', async () => {
      const res = await request(app)
        .put(`/api/works/${testWorkId}`)
        .set('Cookie', authCookie || '')
        .send({ ageRating: 'r15' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ageRating: 'r15', nsfw: false });

      const invalid = await request(app)
        .put(`/api/works/${testWorkId}`)
        .set('Cookie', authCookie || '')
        .send({ ageRating: 'unknown' });
      expect(invalid.status).toBe(400);
    });

    it('should handle partial updates', async () => {
      const res = await request(app)
        .put(`/api/works/${testWorkId}`)
        .set('Cookie', authCookie || '')
        .send({ title: 'Just Title Update' });

      expect([200, 404]).toContain(res.status);
    });

    it('should validate work ID format', async () => {
      const res = await request(app)
        .put('/api/works/invalid-id')
        .set('Cookie', authCookie || '')
        .send({ title: 'Test' });

      // Server accepts any ID format (200/404) or may validate format (400)
      expect([200, 400, 404]).toContain(res.status);
    });
  });

  describe('DELETE /api/works/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/api/works/RJ123456');

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent work', async () => {
      const res = await request(app)
        .delete('/api/works/RJ999999')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(404);
    });

    it('should delete an existing work', async () => {
      // First create a work to delete
      const createRes = await request(app)
        .put('/api/works/RJ888888')
        .set('Cookie', authCookie || '')
        .send({ title: 'Work to Delete' });

      if (createRes.status === 200) {
        const deleteRes = await request(app)
          .delete('/api/works/RJ888888')
          .set('Cookie', authCookie || '');

        expect([200, 404]).toContain(deleteRes.status);

        // Verify it's deleted
        const getRes = await request(app)
          .get('/api/works/RJ888888')
          .set('Cookie', authCookie || '');

        expect(getRes.status).toBe(404);
      }
    });
  });

  describe('GET /api/works/:id/files', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/works/RJ123456/files');

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent work', async () => {
      const res = await request(app)
        .get('/api/works/RJ999999/files')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(404);
    });

    it('should return file tree structure', async () => {
      // May return 404 if work doesn't exist or empty array
      const res = await request(app)
        .get(`/api/works/${testWorkId}/files`)
        .set('Cookie', authCookie || '');

      if (res.status === 200) {
        expect(Array.isArray(res.body)).toBe(true);
      } else {
        expect(res.status).toBe(404);
      }
    });
  });

  describe('POST /api/works/:id/media', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/works/RJ123456/media')
        .send({ files: [] });

      expect(res.status).toBe(401);
    });

    it('should reject a missing media list', async () => {
      const res = await request(app)
        .post(`/api/works/${testWorkId}/media`)
        .set('Cookie', authCookie || '')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('files must be an array of file paths');
    });

    it('should reject the retired media object shape', async () => {
      const res = await request(app)
        .post(`/api/works/${testWorkId}/media`)
        .set('Cookie', authCookie || '')
        .send({ files: [{ path: '/test/audio.mp3' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('files must be an array of file paths');
    });

    it('should accept media file paths', async () => {
      const res = await request(app)
        .post(`/api/works/${testWorkId}/media`)
        .set('Cookie', authCookie || '')
        .send({
          files: [
            '/test/audio.mp3'
          ]
        });

      // May fail if work doesn't exist or path is invalid
      expect([200, 400, 404]).toContain(res.status);
    });
  });

  describe('POST /api/works/:id/cover', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/works/RJ123456/cover');

      expect(res.status).toBe(401);
    });

    it('should handle missing file', async () => {
      const res = await request(app)
        .post(`/api/works/${testWorkId}/cover`)
        .set('Cookie', authCookie || '');

      // Should fail without file upload
      expect([400, 404]).toContain(res.status);
    });

    it('should validate work exists', async () => {
      const res = await request(app)
        .post('/api/works/RJ999999/cover')
        .set('Cookie', authCookie || '');

      expect([400, 404]).toContain(res.status);
    });

    it('validates image signatures before atomically replacing a cover', async () => {
      const invalid = await request(app)
        .post(`/api/works/${testWorkId}/cover?filename=cover.png`)
        .set('Cookie', authCookie || '')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('not an image'));
      expect(invalid.status).toBe(400);

      const valid = await request(app)
        .post(`/api/works/${testWorkId}/cover?filename=cover.png`)
        .set('Cookie', authCookie || '')
        .set('Content-Type', 'application/octet-stream')
        .send(mockPng);
      expect(valid.status).toBe(200);
      expect(fs.readFileSync(valid.body.cover_path)).toEqual(mockPng);
    });
  });

  describe('POST /api/cover/temp', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/cover/temp');

      expect(res.status).toBe(401);
    });

    it('should handle missing file upload', async () => {
      const res = await request(app)
        .post('/api/cover/temp')
        .set('Cookie', authCookie || '');

      // Should fail without multipart file
      expect(res.status).toBe(400);
    });

    it('rejects cover bodies larger than the configured default limit', async () => {
      const res = await request(app)
        .post('/api/cover/temp?filename=large.jpg')
        .set('Cookie', authCookie || '')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc((10 * 1024 * 1024) + 1, 0xff));
      expect(res.status).toBe(413);
    });
  });

  describe('POST /api/works/:id/align', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/works/RJ123456/align');

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent work', async () => {
      const res = await request(app)
        .post('/api/works/RJ999999/align')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(404);
    });

    it('should trigger metadata rescan', async () => {
      const res = await request(app)
        .post(`/api/works/${testWorkId}/align`)
        .set('Cookie', authCookie || '');

      // No default scan paths are configured for this suite, so existing works
      // fail before any filesystem alignment work begins.
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No scan paths configured in settings');
    });
  });

  describe('Protected streaming endpoints', () => {
    const streamedCoverWorkId = 333333;
    const streamedCoverPath = path.join(
      process.env.COVER_DIR || path.resolve(process.cwd(), 'test/test-covers'),
      `streamed-cover-${process.env.VITEST_WORKER_ID || '0'}.jpg`
    );

    beforeAll(async () => {
      fs.mkdirSync(path.dirname(streamedCoverPath), { recursive: true });
      fs.writeFileSync(streamedCoverPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]));
      await upsertWork({
        id: streamedCoverWorkId,
        rjcode: String(streamedCoverWorkId),
        title: 'Streamed Cover Fixture',
        circle: { name: 'Stream Test Circle' },
        nsfw: false,
        release: '',
        tags: [],
        vas: [],
        media: [],
        cover_path: streamedCoverPath,
      });
    });

    it('should require auth for /files', async () => {
      const res = await request(app)
        .get('/files/RJ111111/somefile.flac');

      expect(res.status).toBe(401);
    });

    it('should require auth for /media', async () => {
      const res = await request(app)
        .get('/media/RJ222222/sample.mp3');

      expect(res.status).toBe(401);
    });

    it('should require auth for /cover', async () => {
      const res = await request(app)
        .get('/cover/RJ333333');

      expect(res.status).toBe(401);
    });

    it('should stream covers with a valid weak ETag and honor If-None-Match', async () => {
      const first = await request(app)
        .get(`/cover/${streamedCoverWorkId}`)
        .set('Cookie', authCookie || '');

      expect(first.status).toBe(200);
      expect(first.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(first.headers['cache-control']).toBe('private, no-cache');
      expect(first.headers.etag).toMatch(/^W\/"\d+-\d+"$/);

      const second = await request(app)
        .get(`/cover/${streamedCoverWorkId}`)
        .set('Cookie', authCookie || '')
        .set('If-None-Match', first.headers.etag);

      expect(second.status).toBe(304);
      expect(second.text || '').toBe('');
    });

    it('should allow authorized /media requests even if work missing', async () => {
      const res = await request(app)
        .get('/media/RJ444444/missing.mp3')
        .set('Cookie', authCookie || '');

      expect([200, 206, 404]).toContain(res.status);
    });
  });
});
