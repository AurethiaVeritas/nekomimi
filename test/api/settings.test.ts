import request from 'supertest';
import { vi } from 'vitest';
import type { AxiosResponse } from 'axios';
import app from '../../server/index';
import { bootstrapTestUser } from '../helpers/auth';
import axios from '../../scraper/axios';

describe('Settings API', () => {
  let authCookie: string | null;

  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app), 'settingsuser', 'testpassword1234567');
    authCookie = auth.cookie;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/settings', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/settings');

      expect(res.status).toBe(401);
    });

    it('should return current settings (empty by default)', async () => {
      const res = await request(app)
        .get('/api/settings')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(typeof res.body).toBe('object');
    });
  });

  describe('PUT /api/settings', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/api/settings')
        .send({ autoScanEnabled: false });

      expect(res.status).toBe(401);
    });

    it('should update settings', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({
          autoScanEnabled: false,
          autoScanIntervalMinutes: 120,
          timeZone: 'America/New_York',
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

      // Verify the changes persisted
      const getRes = await request(app)
        .get('/api/settings')
        .set('Cookie', authCookie || '');

      expect(getRes.body.autoScanEnabled).toBe(false);
      expect(getRes.body.autoScanIntervalMinutes).toBe(120);
      expect(getRes.body.timeZone).toBe('America/New_York');
    });

    it('should reject an invalid timezone', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({ timeZone: 'Not/A_Timezone' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid timezone');
    });

    it('should reject the retired string proxy port shape', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({ httpProxyPort: '8080' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid proxy port');
    });

    it('should update autoplay behavior', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({
          autoplayFolder: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.autoplayFolder).toBe(true);
    });

    it('should persist and apply enabled server log levels', async () => {
      const marker = `disabled-info-${Date.now()}`;

      try {
        const updateRes = await request(app)
          .put('/api/settings')
          .set('Cookie', authCookie || '')
          .send({ serverLogLevels: ['warn', 'error'] });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.serverLogLevels).toEqual(['warn', 'error']);

        console.log(marker);

        const [settingsRes, logsRes] = await Promise.all([
          request(app).get('/api/settings').set('Cookie', authCookie || ''),
          request(app).get('/api/logs').set('Cookie', authCookie || ''),
        ]);

        expect(settingsRes.body.serverLogLevels).toEqual(['warn', 'error']);
        expect(logsRes.body.logs).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ level: 'info', message: marker }),
        ]));
      } finally {
        await request(app)
          .put('/api/settings')
          .set('Cookie', authCookie || '')
          .send({ serverLogLevels: ['info', 'warn', 'error'] });
      }
    });

    it('should reject invalid server log levels', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Cookie', authCookie || '')
        .send({ serverLogLevels: ['debug'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid server log levels');
    });
  });

  describe('POST /api/settings/proxy-check', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/settings/proxy-check');

      expect(res.status).toBe(401);
    });

    it('should report outbound IP and DLsite reachability', async () => {
      vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
        if (url === 'https://ipconfig.org') {
          return { status: 200, data: '203.0.113.10\n' } as AxiosResponse<string>;
        }
        if (url === 'https://www.dlsite.com/') {
          return { status: 200, data: '<html></html>' } as AxiosResponse<string>;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      const res = await request(app)
        .post('/api/settings/proxy-check')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ip).toEqual({ ok: true, address: '203.0.113.10' });
      expect(res.body.dlsite).toEqual({ ok: true, status: 200 });
      expect(res.body.checkedAt).toBeDefined();
    });

    it('should return partial failure details when DLsite cannot be reached', async () => {
      vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
        if (url === 'https://ipconfig.org') {
          return { status: 200, data: '203.0.113.10' } as AxiosResponse<string>;
        }
        throw new Error('connect ECONNREFUSED');
      });

      const res = await request(app)
        .post('/api/settings/proxy-check')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.ip.ok).toBe(true);
      expect(res.body.dlsite.ok).toBe(false);
      expect(res.body.dlsite.error).toContain('connect ECONNREFUSED');
    });
  });
});
