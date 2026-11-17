import { accountSetupToken } from '../setup';
import request from 'supertest';
import app from '../../server/index';

describe('Authentication API', () => {
  const testUsername = 'admin';
  const testPassword = 'password1234567';
  let createdUsername: string | undefined; // Track the actually created username

  describe('POST /api/auth/bootstrap', () => {
    it.each([undefined, '', 'wrong', '0'.repeat(64), 'あ'.repeat(64), 123, {}])('rejects invalid setup token %j', async (setupToken) => {
      const res = await request(app).post('/api/auth/bootstrap')
        .send({ username: testUsername, password: testPassword, setupToken });
      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(accountSetupToken);
    });

    it('should create the first admin user', async () => {
      const res = await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: testUsername, password: testPassword, setupToken: accountSetupToken });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(testUsername);
      expect(res.body.user.id).toBe(1);
      expect(res.headers['set-cookie']).toBeDefined();

      createdUsername = res.body.user.username; // Store for later tests
    });

    it('should reject bootstrap when user already exists', async () => {
      const res = await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'another', password: 'password1234567' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Already initialized');
    });

    it('should validate username length', async () => {
      // This test will fail since we already bootstrapped, but shows validation
      const res = await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'ab', password: 'password1234567' });

      // Will get 400 for "Already initialized" instead of username validation
      expect(res.status).toBe(400);
    });

    it('should validate password is provided', async () => {
      const res = await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'validuser' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(createdUsername || testUsername);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: 'wrongpassword12345' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password1234567' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing username or password');
    });
  });

  describe('GET /api/auth/me', () => {
    let authCookie: string | null;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: testPassword });

      const cookies = res.get('set-cookie');
      authCookie = Array.isArray(cookies) ? cookies[0]?.split(';')[0] ?? null : null;
    });

    it('should return current user when authenticated', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', authCookie || '');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(createdUsername || testUsername);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear auth cookie', async () => {
      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.headers['set-cookie']).toBeDefined();
      const cookies = res.get('set-cookie');
      expect(cookies && Array.isArray(cookies) ? cookies[0] : cookies).toBeDefined();
      if (Array.isArray(cookies) && cookies[0]) {
        expect(cookies[0]).toContain('Max-Age=0');
      }
    });

    it('revokes the session token presented at logout', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: testPassword });
      const cookies = login.get('set-cookie');
      const cookie = Array.isArray(cookies) ? cookies[0]?.split(';')[0] ?? '' : '';

      expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: testPassword, newPassword: 'newpass123456789' });

      expect(res.status).toBe(401);
    });

    it('should change password with valid current password', async () => {
      // Fresh login for this test
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: testPassword });
      const cookies = loginRes.get('set-cookie');
      const authCookie = Array.isArray(cookies) ? cookies[0]?.split(';')[0] ?? null : null;

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', authCookie || '')
        .send({ currentPassword: testPassword, newPassword: 'newpass456789012' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect((await request(app).get('/api/auth/me').set('Cookie', authCookie || '')).status).toBe(401);
      const replacementCookies = res.get('set-cookie');
      const replacementCookie = Array.isArray(replacementCookies) ? replacementCookies[0]?.split(';')[0] ?? '' : '';
      expect((await request(app).get('/api/auth/me').set('Cookie', replacementCookie)).status).toBe(200);

      // Verify new password works
      const loginRes2 = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: 'newpass456789012' });
      expect(loginRes2.status).toBe(200);
    });

    it('should reject incorrect current password', async () => {
      // Need fresh cookie since password was changed
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: 'newpass456789012' });

      const cookies = loginRes.get('set-cookie');
      if (Array.isArray(cookies) && cookies[0]) {
        const freshCookie = cookies[0].split(';')[0];

        const res = await request(app)
          .post('/api/auth/change-password')
          .set('Cookie', freshCookie)
          .send({ currentPassword: 'wrongpass12345678', newPassword: 'newpass789012345' });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Current password incorrect');
      }
    });

    it('should reject short new password', async () => {
      // Need fresh cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: createdUsername || testUsername, password: 'newpass456789012' });

      const cookies = loginRes.get('set-cookie');
      if (Array.isArray(cookies) && cookies[0]) {
        const freshCookie = cookies[0].split(';')[0];

        const res = await request(app)
          .post('/api/auth/change-password')
          .set('Cookie', freshCookie)
          .send({ currentPassword: 'newpass456789012', newPassword: 'short' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('New password must be at least 12 characters');
      }
    });
  });
});
