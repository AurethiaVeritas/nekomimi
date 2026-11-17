import request from 'supertest';
import app from '../../server/index';

describe('Health Check', () => {
  describe('GET /api/health', () => {
    it('should return OK without authentication', async () => {
      const res = await request(app)
        .get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
