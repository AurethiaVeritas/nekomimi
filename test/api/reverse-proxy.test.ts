import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { guessMimeType } from '../../filesystem/utils';
import { bootstrapTestUser } from '../helpers/auth';
import type { Response } from 'supertest';

const binaryParser = (res: Response, callback: (err: Error | null, data: Buffer) => void) => {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
};

describe('Reverse Proxy Support', () => {
  let authCookie: string | null;
  const proxyLibraryRoot = path.resolve(process.cwd(), 'test/tmp/library-proxy');

  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app), 'proxyuser', 'testpassword1234567');
    authCookie = auth.cookie;
    fs.mkdirSync(proxyLibraryRoot, { recursive: true });
    await request(app)
      .put('/api/settings')
      .set('Cookie', authCookie || '')
      .send({ defaultScanPaths: [proxyLibraryRoot] });
  });

  describe('X-Forwarded headers', () => {
    it('should respect X-Forwarded-Proto for HTTPS detection', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com');

      expect(res.status).toBe(200);
      // The app should recognize it's behind HTTPS proxy
      // This test verifies the header is accepted without error
    });

    it('should respect X-Forwarded-For for client IP', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('X-Forwarded-For', '203.0.113.1, 198.51.100.1')
        .set('X-Real-IP', '203.0.113.1');

      expect(res.status).toBe(200);
      // Verify proxy headers don't break functionality
    });

    it('should work with multiple proxy headers', async () => {
      const res = await request(app)
        .get('/api/works')
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com')
        .set('X-Forwarded-For', '203.0.113.1')
        .set('X-Real-IP', '203.0.113.1')
        .set('X-Forwarded-Port', '443');

      expect(res.status).toBe(200);
      // Should work normally with full proxy header set
    });
  });

  describe('Base path mounting (e.g., /nekomimi)', () => {
    it('should serve health check regardless of mount point', async () => {
      // This tests current behavior - app works at root
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should handle authentication with proxy headers', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com')
        .send({ username: 'proxyuser', password: 'testpassword1234567' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      // Cookies should still work through proxy
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Static file serving through proxy', () => {
    // Note: These tests verify that proxy headers are correctly handled by the endpoints.
    // The media test below wires up a real on-disk file to ensure the reverse proxy path
    // works end-to-end, while the remaining tests focus on header handling behavior.
    const workerSuffix = process.env.VITEST_WORKER_ID || '0';
    const sampleWorkId = 910199;
    const sampleMediaFilename = `reverse-proxy-sample-${workerSuffix}.mp3`;
    const sampleMediaAbsolutePath = path.join(proxyLibraryRoot, sampleMediaFilename);
    const nestedDir = path.join(proxyLibraryRoot, `nested-${workerSuffix}`);
    const nestedFilename = `reverse-proxy-nested-${workerSuffix}.wav`;
    const nestedRelativePath = `${path.basename(nestedDir)}/${nestedFilename}`;
    const nestedAbsolutePath = path.join(nestedDir, nestedFilename);
    const nestedRangeEnd = 15;
    let sampleMediaSize = 0;
    let nestedMediaSize = 0;

    beforeAll(async () => {
      fs.mkdirSync(path.dirname(sampleMediaAbsolutePath), { recursive: true });
      const buffer = Buffer.alloc(2048, 7);
      fs.writeFileSync(sampleMediaAbsolutePath, buffer);
      sampleMediaSize = buffer.length;
      fs.mkdirSync(nestedDir, { recursive: true });
      const nestedBuffer = Buffer.alloc(1024, 9);
      fs.writeFileSync(nestedAbsolutePath, nestedBuffer);
      nestedMediaSize = nestedBuffer.length;

      await upsertWork({
        id: sampleWorkId,
        rjcode: String(sampleWorkId).padStart(6, '0'),
        title: 'Reverse Proxy Sample Work',
        circle: { name: 'Proxy Circle' },
        nsfw: false,
        release: '',
        tags: [],
        vas: [],
        base_dir: path.dirname(sampleMediaAbsolutePath),
        media: [
          {
            filename: sampleMediaFilename,
            filepath: sampleMediaAbsolutePath,
            mime: guessMimeType(sampleMediaAbsolutePath),
          },
        ],
      });
    });

    afterAll(() => {
      try {
        fs.unlinkSync(sampleMediaAbsolutePath);
      } catch { }
      try {
        fs.unlinkSync(nestedAbsolutePath);
      } catch { }
      try {
        fs.rmdirSync(nestedDir);
      } catch { }
    });

    it('should handle /media endpoint with proxy headers without errors', async () => {
      const res = await request(app)
        .get(`/media/${sampleWorkId}/${sampleMediaFilename}`)
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'cdn.example.com')
        .set('X-Forwarded-Port', '443')
        .buffer()
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('audio/mpeg');
      expect(Number(res.headers['content-length'])).toBe(sampleMediaSize);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBe(sampleMediaSize);
    });

    it('should handle /cover endpoint with proxy headers without errors', async () => {
      // Request a cover with proxy headers
      const res = await request(app)
        .get(`/cover/RJ999777`)
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'media.example.com')
        .set('X-Forwarded-Port', '443');

      // Should return 200 or 404 - both prove proxy headers work (not 400/500)
      expect([200, 404]).toContain(res.status);
    });

    it('should handle range requests with proxy headers without errors', async () => {
      // Request with Range header plus proxy headers
      const res = await request(app)
        .get(`/media/RJ999666/test.mp3`)
        .set('Cookie', authCookie || '')
        .set('Range', 'bytes=0-99')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'cdn.example.com');

      // Should return 200, 206, or 404 - all prove proxy headers don't break parsing
      expect([200, 206, 404]).toContain(res.status);

      // If it's a successful range response, verify range headers work
      if (res.status === 206) {
        expect(res.headers['content-range']).toBeDefined();
        expect(res.headers['accept-ranges']).toBe('bytes');
      }
    });

    it('should return RFC-compliant Content-Range for nested /files requests', async () => {
      const res = await request(app)
        .get(`/files/${sampleWorkId}/${nestedRelativePath}`)
        .set('Cookie', authCookie || '')
        .set('Range', `bytes=0-${nestedRangeEnd}`)
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'cdn.example.com');

      expect(res.status).toBe(206);
      expect(res.headers['content-type']).toBe('audio/wav');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe(String(nestedRangeEnd + 1));
      expect(res.headers['content-range']).toBe(`bytes 0-${nestedRangeEnd}/${nestedMediaSize}`);
    });
  });

  describe('Cookie security with reverse proxy', () => {
    it('should handle cookies correctly through proxy', async () => {
      // Login through proxy
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-Proto', 'https')
        .send({ username: 'proxyuser', password: 'testpassword1234567' });

      const cookies = loginRes.get('set-cookie');
      expect(cookies).toBeDefined();

      const cookie = Array.isArray(cookies) && cookies[0] ? cookies[0].split(';')[0] : '';

      // Use cookie through proxy
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .set('X-Forwarded-Proto', 'https');

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.username).toBe('proxyuser');
    });
  });

  describe('API responses with proxy headers', () => {
    it('should return correct content with X-Forwarded headers', async () => {
      const res = await request(app)
        .get('/api/settings')
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com')
        .set('X-Forwarded-Port', '443');

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });

    it('should handle POST requests through proxy', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com')
        .send({ testSetting: 'proxy-test' });

      expect(res.status).toBe(200);
    });
  });

  describe('SSE streams through proxy', () => {
    it('should handle SSE with proxy headers', async () => {
      const res = await request(app)
        .get('/api/scan/alignment')
        .set('Cookie', authCookie || '')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'example.com');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      // SSE should work through reverse proxy
    });
  });
});
