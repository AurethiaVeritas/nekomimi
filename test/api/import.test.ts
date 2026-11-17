import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { vi } from 'vitest';
import app from '../../server/index';
import { getWork, upsertWork } from '../../server/db';
import { performImportWorkFromDLsite } from '../../server/workImport';
import { bootstrapTestUser } from '../helpers/auth';

const externalScraperMocks = vi.hoisted(() => {
  const metadataFor = (id: number, source = 'DLsite') => ({
    id,
    title: `Mock ${source} Work RJ${String(id).padStart(6, '0')}`,
    circle: { id: `${source.toLowerCase()}-circle`, name: `Mock ${source} Circle` },
    nsfw: false,
    release: '2024-01-01',
    tags: [{ id: `${source.toLowerCase()}-tag`, name: `Mock ${source} Tag` }],
    vas: [{ id: `${source.toLowerCase()}-va`, name: `Mock ${source} VA` }],
    dl_count: '42',
    rate_average_2dp: 4.25,
    rate_count: 8,
    rate_count_detail: null,
    review_count: 2,
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
  scrapeWorkMetadataFromDLsite: externalScraperMocks.scrapeDlsite,
}));

vi.mock('../../scraper/asmrOne', () => ({
  scrapeWorkMetadataFromAsmrOne: externalScraperMocks.scrapeAsmrOne,
}));

vi.mock('../../scraper/hvdb', () => ({
  scrapeWorkMetadataFromHVDB: externalScraperMocks.scrapeHvdb,
}));

vi.mock('../../scraper/axios', () => ({
  default: {
    retryGet: externalScraperMocks.retryGet,
    get: externalScraperMocks.get,
  },
}));

const mockPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

function resetExternalScraperMocks() {
  externalScraperMocks.scrapeDlsite.mockReset();
  externalScraperMocks.scrapeAsmrOne.mockReset();
  externalScraperMocks.scrapeHvdb.mockReset();
  externalScraperMocks.retryGet.mockReset();
  externalScraperMocks.get.mockReset();

  externalScraperMocks.scrapeDlsite.mockImplementation(async (id: number) => externalScraperMocks.metadataFor(id, 'DLsite'));
  externalScraperMocks.scrapeAsmrOne.mockImplementation(async (id: number) => externalScraperMocks.metadataFor(id, 'ASMROne'));
  externalScraperMocks.scrapeHvdb.mockImplementation(async (id: number) => externalScraperMocks.metadataFor(id, 'HVDB'));
  externalScraperMocks.retryGet.mockResolvedValue({
    data: mockPng,
    headers: { 'content-type': 'image/png' },
  });
  externalScraperMocks.get.mockRejectedValue(new Error('Unexpected direct axios.get call in import API tests'));
}

describe('Import and Scraping API', () => {
  let authCookie: string | null;
  const libraryRoot = path.resolve(process.cwd(), 'test/tmp/library-import');

  beforeEach(() => {
    resetExternalScraperMocks();
  });

  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app));
    authCookie = auth.cookie;
    fs.mkdirSync(libraryRoot, { recursive: true });
    await request(app)
      .put('/api/settings')
      .set('Cookie', authCookie || '')
      .send({ defaultScanPaths: [libraryRoot] });
  });

  afterAll(() => {
    fs.rmSync(path.join(libraryRoot, 'RJ888888'), { recursive: true, force: true });
  });

  describe('POST /api/import/dlsite', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .send({ id: 'RJ123456' });

      expect(res.status).toBe(401);
    });

    it('should validate required id field', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should validate RJ id format', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'invalid-id' });

      // Should fail with invalid format
      expect([400, 500]).toContain(res.status);
    });

    it('should accept valid RJ id format', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(123456);
      expect(res.body.title).toBe('Mock DLsite Work RJ123456');
      expect(externalScraperMocks.scrapeDlsite).toHaveBeenCalledWith(123456, 'ja-jp', expect.any(AbortSignal));
    });

    it('should accept RJ id with leading zeros', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ01234567' }); // 8-digit format

      expect(res.status).toBe(200);
      expect(res.body.rjcode).toBe('01234567');
      expect(externalScraperMocks.scrapeDlsite).toHaveBeenCalledWith(1234567, 'ja-jp', expect.any(AbortSignal));
    });

    it('should accept numeric id', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 123456 });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(123456);
    });

    it('imports an R-15 work with media and a copied local cover under isolated storage', async () => {
      const mediaPath = path.join(libraryRoot, 'RJ888888');
      fs.mkdirSync(mediaPath, { recursive: true });
      fs.writeFileSync(path.join(mediaPath, 'track.mp3'), Buffer.from('sample audio'));
      fs.writeFileSync(path.join(mediaPath, 'cover.png'), mockPng);
      externalScraperMocks.scrapeDlsite.mockResolvedValue({
        ...externalScraperMocks.metadataFor(888888), ageRating: 'r15', nsfw: false,
      });

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ888888', mediaPath });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ageRating: 'r15', nsfw: false, base_dir: mediaPath });
      expect(res.body.media).toEqual(expect.arrayContaining([
        expect.objectContaining({ filepath: path.join(mediaPath, 'track.mp3') }),
      ]));
      expect(res.body.cover_path).toBe(path.join(path.resolve(process.env.COVER_DIR || ''), 'RJ888888.png'));
      expect(fs.existsSync(res.body.cover_path)).toBe(true);
    });

    it('should not retry duplicate cover candidates for an unpadded id', async () => {
      externalScraperMocks.retryGet.mockRejectedValue(new Error('mock cover unavailable'));

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ654321' });

      expect(res.status).toBe(200);
      const attemptedUrls = externalScraperMocks.retryGet.mock.calls.map(([url]) => url);
      expect(attemptedUrls).toEqual([
        'https://api.asmr-200.com/api/cover/654321.jpg?type=main',
        'https://api.asmr-200.com/api/cover/654321.jpg?type=thumb',
      ]);
    });

    it('tries the next local cover when the first candidate is invalid', async () => {
      const mediaPath = path.join(process.env.DATA_DIR!, 'library', 'RJ888887');
      fs.mkdirSync(path.join(mediaPath, 'cover'), { recursive: true });
      fs.writeFileSync(path.join(mediaPath, 'cover', 'a-invalid.png'), 'invalid image');
      fs.writeFileSync(path.join(mediaPath, 'cover', 'b-valid.png'), mockPng);
      fs.writeFileSync(path.join(mediaPath, 'track.mp3'), 'sample audio');

      const res = await request(app).post('/api/import/dlsite').set('Cookie', authCookie || '')
        .send({ id: 'RJ888887', mediaPath });

      expect(res.status).toBe(200);
      expect(res.body.base_dir).toBe(mediaPath);
      expect(res.body.media).toEqual([expect.objectContaining({ filepath: path.join(mediaPath, 'track.mp3') })]);
      expect(fs.readFileSync(res.body.cover_path)).toEqual(mockPng);
      expect(externalScraperMocks.retryGet).not.toHaveBeenCalled();
    });

    it.each([true, false])('removes a temporary cover only after a successful copy (valid: %s)', async valid => {
      const coverPath = path.join(process.env.COVER_DIR!, `temp-copy-${valid}.png`);
      const body = valid ? mockPng : Buffer.from('invalid image');
      fs.writeFileSync(coverPath, body);
      const res = await request(app).post('/api/import/dlsite').set('Cookie', authCookie || '')
        .send({ id: valid ? 'RJ888886' : 'RJ888885', coverPath });

      expect(res.status).toBe(200);
      expect(fs.existsSync(coverPath)).toBe(!valid);
      expect(fs.readFileSync(res.body.cover_path)).toEqual(mockPng);
      if (!valid) expect(fs.readFileSync(coverPath)).toEqual(body);
      expect(externalScraperMocks.retryGet.mock.calls.length).toBe(valid ? 0 : 1);
    });

    it('preserves provider fallback order and propagates the final failure', async () => {
      externalScraperMocks.scrapeDlsite.mockRejectedValue(new Error('DLsite unavailable'));
      externalScraperMocks.scrapeAsmrOne.mockRejectedValue(new Error('ASMROne unavailable'));
      const res = await request(app).post('/api/import/dlsite').set('Cookie', authCookie || '')
        .send({ id: 'RJ888884' });
      expect(res.status).toBe(200);
      expect(res.body.title).toContain('HVDB');
      expect(externalScraperMocks.scrapeDlsite.mock.invocationCallOrder[0])
        .toBeLessThan(externalScraperMocks.scrapeAsmrOne.mock.invocationCallOrder[0]);
      expect(externalScraperMocks.scrapeAsmrOne.mock.invocationCallOrder[0])
        .toBeLessThan(externalScraperMocks.scrapeHvdb.mock.invocationCallOrder[0]);

      externalScraperMocks.scrapeHvdb.mockRejectedValue(new Error('HVDB unavailable'));
      const failed = await request(app).post('/api/import/dlsite').set('Cookie', authCookie || '')
        .send({ id: 'RJ888883' });
      expect(failed.status).toBe(500);
      expect(failed.body.error).toBe('HVDB unavailable');
      expect(await getWork(888883)).toBeNull();
    });

    it('stops cancelled imports before fallback requests or persistence', async () => {
      const controller = new AbortController();
      externalScraperMocks.scrapeDlsite.mockImplementation(async () => {
        controller.abort(new Error('Import cancelled'));
        throw new Error('Request aborted');
      });
      await expect(performImportWorkFromDLsite({ id: 'RJ888882', signal: controller.signal }))
        .rejects.toThrow('Import cancelled');
      expect(externalScraperMocks.scrapeAsmrOne).not.toHaveBeenCalled();
      expect(externalScraperMocks.scrapeHvdb).not.toHaveBeenCalled();
      expect(externalScraperMocks.retryGet).not.toHaveBeenCalled();
      expect(await getWork(888882)).toBeNull();
    });

    it('rejects untrusted metadata cover hosts and disables cover redirects', async () => {
      externalScraperMocks.scrapeDlsite.mockResolvedValue({
        ...externalScraperMocks.metadataFor(777777, 'DLsite'),
        cover_url: 'http://127.0.0.1/internal-cover.png',
      });

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ777777' });

      expect(res.status).toBe(200);
      expect(externalScraperMocks.retryGet).not.toHaveBeenCalledWith(
        'http://127.0.0.1/internal-cover.png',
        expect.anything(),
      );
      expect(externalScraperMocks.retryGet).toHaveBeenCalledWith(
        expect.stringContaining('api.asmr-200.com/api/cover/777777.jpg'),
        expect.objectContaining({ maxRedirects: 0, maxContentLength: 10 * 1024 * 1024 }),
      );
    });

    it('should accept language parameter', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({
          id: 'RJ123456',
          language: 'en-us'
        });

      expect(res.status).toBe(200);
      expect(externalScraperMocks.scrapeDlsite).toHaveBeenCalledWith(123456, 'en-us', expect.any(AbortSignal));
    });

    it('should reject too short id', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123' });

      // Should fail - too short
      expect([400, 500]).toContain(res.status);
    });

    it('should reject too long id', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456789' }); // 9 digits - too long

      expect([400, 500]).toContain(res.status);
    });

    it('should reject mediaPath outside allowed library roots', async () => {
      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456', mediaPath: '/tmp/not-allowed' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/allowed library/);
    });
  });

  describe('GET /api/scan/alignment', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/scan/alignment');

      expect(res.status).toBe(401);
    });

    it('should return SSE stream (text/event-stream)', async () => {
      const res = await request(app)
        .get('/api/scan/alignment')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('should accept path parameter', async () => {
      const customPath = path.join(libraryRoot, 'custom');
      fs.mkdirSync(customPath, { recursive: true });
      const res = await request(app)
        .get('/api/scan/alignment')
        .query({ path: customPath })
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });
  });

  describe('SMB-incompatible work directories', () => {
    it('returns an actionable conflict instead of a missing-directory response', async () => {
      const workId = 919197;
      const inaccessiblePath = path.join(libraryRoot, 'Listed but inaccessible?');
      fs.mkdirSync(inaccessiblePath, { recursive: true });
      await upsertWork({
        id: workId,
        rjcode: String(workId),
        title: 'SMB path fixture',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: { dl_count: 0, rate_average_2dp: 0, rate_count: 0, review_count: 0, rank: [], rate_count_detail: null },
        media: [],
        base_dir: inaccessiblePath,
        cover_path: null,
      });

      const originalExistsSync = fs.existsSync;
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation(targetPath => (
        targetPath === inaccessiblePath ? false : originalExistsSync(targetPath)
      ));

      try {
        const res = await request(app)
          .get(`/api/works/${workId}/files`)
          .set('Cookie', authCookie || '');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('SMB_FILENAME_UNREACHABLE');
        expect(res.body.inaccessiblePath).toBe(inaccessiblePath);
        expect(res.body.suggestedPath).toBe(path.join(libraryRoot, 'Listed but inaccessible？'));
        expect(res.body.error).toMatch(/Rename it at the storage source/);
        expect(res.body.error).not.toMatch(/NAS|macOS/);
      } finally {
        existsSpy.mockRestore();
      }
    });

    it('reports the same repair requirement from single-work alignment', async () => {
      const workId = 919196;
      const inaccessiblePath = path.join(libraryRoot, 'Alignment inaccessible:');
      const coverDir = path.resolve(process.env.COVER_DIR || 'test/test-covers');
      const managedCoverPath = path.join(coverDir, `RJ${workId}.jpg`);
      fs.mkdirSync(inaccessiblePath, { recursive: true });
      fs.mkdirSync(coverDir, { recursive: true });
      fs.writeFileSync(managedCoverPath, mockPng);
      await upsertWork({
        id: workId,
        rjcode: String(workId),
        title: 'SMB alignment fixture',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: { dl_count: 0, rate_average_2dp: 0, rate_count: 0, review_count: 0, rank: [], rate_count_detail: null },
        media: [],
        base_dir: inaccessiblePath,
        cover_path: null,
      });

      const originalExistsSync = fs.existsSync;
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation(targetPath => (
        targetPath === inaccessiblePath ? false : originalExistsSync(targetPath)
      ));

      try {
        const res = await request(app)
          .post(`/api/works/${workId}/align`)
          .set('Cookie', authCookie || '');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          aligned: false,
          repairRequired: true,
          issueCode: 'SMB_FILENAME_UNREACHABLE',
          coverRestored: true,
          cover_path: managedCoverPath,
        });
        expect(res.body.suggestedPath).toBe(path.join(libraryRoot, 'Alignment inaccessible：'));
        expect((await getWork(workId))?.cover_path).toBe(managedCoverPath);
      } finally {
        existsSpy.mockRestore();
      }
    });
  });

  describe('POST /api/works/:id/align', () => {
    it('moves an outdated path and restores an existing managed cover', async () => {
      const workId = 919198;
      const workPath = path.join(libraryRoot, `RJ${workId}`);
      const coverDir = path.resolve(process.env.COVER_DIR || 'test/test-covers');
      const managedCoverPath = path.join(coverDir, `RJ${workId}.jpg`);
      fs.mkdirSync(workPath, { recursive: true });
      fs.mkdirSync(coverDir, { recursive: true });
      fs.writeFileSync(path.join(workPath, 'track.mp3'), Buffer.from('test audio'));
      fs.writeFileSync(managedCoverPath, mockPng);
      await upsertWork({
        id: workId,
        rjcode: String(workId),
        title: 'Alignment cover fixture',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: { dl_count: 0, rate_average_2dp: 0, rate_count: 0, review_count: 0, rank: [], rate_count_detail: null },
        media: [],
        base_dir: path.join(libraryRoot, 'old-missing-location'),
        cover_path: null,
      });

      const res = await request(app)
        .post(`/api/works/${workId}/align`)
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        aligned: true,
        coverRestored: true,
        base_dir: workPath,
        cover_path: managedCoverPath,
      });
      expect(res.body.media).toEqual(expect.arrayContaining([
        expect.objectContaining({ filename: 'track.mp3' }),
      ]));
    });
  });

  describe('POST /api/scan (newOnly)', () => {
    const baseStats = { dl_count: 0, rate_average_2dp: 0, rate_count: 0, review_count: 0, rank: [], rate_count_detail: null };

    it('should default to newOnly mode when newOnly is omitted', async () => {
      const scanRoot = path.join(libraryRoot, 'new-only-default');
      const existingId = '333333';
      const newId = '444444';
      fs.mkdirSync(path.join(scanRoot, `RJ${existingId}`), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, `RJ${newId}`), { recursive: true });
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        media: [],
      });

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: scanRoot, dryRun: true });

      expect(res.status).toBe(200);
      const foundIds = (res.body.found || []).map((item: { id: string }) => String(item.id));
      expect(foundIds).toContain(newId);
      expect(foundIds).not.toContain(existingId);
    });

    it('should filter out existing works when newOnly is true', async () => {
      const scanRoot = path.join(libraryRoot, 'new-only');
      const existingId = '111111';
      const newId = '222222';
      fs.mkdirSync(path.join(scanRoot, `RJ${existingId}`), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, `RJ${newId}`), { recursive: true });
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        media: [],
      });

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: scanRoot, dryRun: true, newOnly: true });

      expect(res.status).toBe(200);
      const foundIds = (res.body.found || []).map((item: { id: string }) => String(item.id));
      expect(foundIds).toContain(newId);
      expect(foundIds).not.toContain(existingId);
    });

    it('should include existing works when newOnly is explicitly false', async () => {
      const scanRoot = path.join(libraryRoot, 'rescan-all');
      const existingId = '555555';
      const newId = '666666';
      fs.mkdirSync(path.join(scanRoot, `RJ${existingId}`), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, `RJ${newId}`), { recursive: true });
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        media: [],
      });

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: scanRoot, dryRun: true, newOnly: false });

      expect(res.status).toBe(200);
      const foundIds = (res.body.found || []).map((item: { id: string }) => String(item.id));
      expect(foundIds).toContain(newId);
      expect(foundIds).toContain(existingId);
    });

    it('should include only existing works when metadataOnly is true', async () => {
      const scanRoot = path.join(libraryRoot, 'metadata-only');
      const existingId = '654321';
      const newId = '765432';
      fs.mkdirSync(path.join(scanRoot, `RJ${existingId}`), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, `RJ${newId}`), { recursive: true });
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Metadata Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        media: [],
      });

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: scanRoot, dryRun: true, metadataOnly: true });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('metadata-only');
      const foundIds = (res.body.found || []).map((item: { id: string }) => String(item.id));
      expect(foundIds).toContain(existingId);
      expect(foundIds).not.toContain(newId);
    });

    it('should not replace cover with question mark when scan root is unavailable', async () => {
      const downRoot = path.join(libraryRoot, 'down-storage');
      const existingId = '777777';
      const originalCoverPath = '/tmp/original-cover.jpg';
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        base_dir: path.join(downRoot, `RJ${existingId}`),
        cover_path: originalCoverPath,
        media: [],
      });

      // Ensure this root is unavailable during the scan
      try { fs.rmSync(downRoot, { recursive: true, force: true }); } catch { /* ignore */ }

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: downRoot, dryRun: false, newOnly: true });

      expect(res.status).toBe(200);

      const updated = await getWork(Number(existingId));
      expect(updated).not.toBeNull();
      expect(updated?.cover_path).toBe(originalCoverPath);
    });

    it('should not replace cover with question mark when scan root is reachable but no works are detected', async () => {
      const emptyRoot = path.join(libraryRoot, 'empty-storage-view');
      const existingId = '888888';
      const originalCoverPath = '/tmp/original-cover-empty-root.jpg';
      fs.mkdirSync(emptyRoot, { recursive: true });
      await upsertWork({
        id: Number(existingId),
        rjcode: existingId,
        title: 'Existing Work',
        circle: { name: 'Test Circle' },
        nsfw: false,
        release: '2024-01-01',
        tags: [],
        vas: [],
        stats: baseStats,
        base_dir: path.join(emptyRoot, `RJ${existingId}`), // points to missing subfolder
        cover_path: originalCoverPath,
        media: [],
      });

      const res = await request(app)
        .post('/api/scan')
        .set('Cookie', authCookie || '')
        .send({ path: emptyRoot, dryRun: false, newOnly: true });

      expect(res.status).toBe(200);

      const updated = await getWork(Number(existingId));
      expect(updated).not.toBeNull();
      expect(updated?.cover_path).toBe(originalCoverPath);
    });
  });

  describe('Import Error Handling', () => {
    it('should handle provider failures gracefully', async () => {
      externalScraperMocks.scrapeDlsite.mockRejectedValueOnce(new Error('mock DLsite unavailable'));
      externalScraperMocks.scrapeAsmrOne.mockRejectedValueOnce(new Error('mock ASMROne unavailable'));
      externalScraperMocks.scrapeHvdb.mockRejectedValueOnce(new Error('mock HVDB unavailable'));

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ000001' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('mock HVDB unavailable');
    });

    it('should handle missing metadata gracefully', async () => {
      externalScraperMocks.scrapeDlsite.mockRejectedValueOnce(new Error('mock missing DLsite metadata'));
      externalScraperMocks.scrapeAsmrOne.mockRejectedValueOnce(new Error('mock missing ASMROne metadata'));
      externalScraperMocks.scrapeHvdb.mockRejectedValueOnce(new Error('mock missing HVDB metadata'));

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ999999' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('mock missing HVDB metadata');
    });
  });

  describe('Metadata Scraping Order', () => {
    it('should attempt multiple sources', async () => {
      externalScraperMocks.scrapeDlsite.mockRejectedValueOnce(new Error('mock DLsite unavailable'));
      externalScraperMocks.scrapeAsmrOne.mockRejectedValueOnce(new Error('mock ASMROne unavailable'));
      externalScraperMocks.scrapeHvdb.mockResolvedValueOnce(externalScraperMocks.metadataFor(123456, 'HVDB'));

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Mock HVDB Work RJ123456');
      expect(externalScraperMocks.scrapeDlsite).toHaveBeenCalledTimes(1);
      expect(externalScraperMocks.scrapeAsmrOne).toHaveBeenCalledTimes(1);
      expect(externalScraperMocks.scrapeHvdb).toHaveBeenCalledTimes(1);
    });
  });

  describe('Import with Proxy Settings', () => {
    it('should respect proxy settings if configured', async () => {
      // First set proxy settings
      await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({
          httpProxyEnabled: false, // Disabled for testing
        });

      const res = await request(app)
        .post('/api/import/dlsite')
        .set('Cookie', authCookie || '')
        .send({ id: 'RJ123456' });

      expect(res.status).toBe(200);
      expect(externalScraperMocks.scrapeDlsite).toHaveBeenCalledWith(123456, 'ja-jp', expect.any(AbortSignal));
    });
  });
});
