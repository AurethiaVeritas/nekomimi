import { accountSetupToken } from '../setup';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Agent, SuperTest, Test } from 'supertest';

/**
 * Base64 URL encoding helper
 */
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Sign a JWT token for testing purposes
 * @param {Object} payload - JWT payload (should include sub and username)
 * @param {Buffer|string} secret - Secret key for signing
 * @param {number} expiresInSec - Expiration time in seconds
 * @returns {string} Signed JWT token
 */
export function signTestJWT(payload: Record<string, unknown>, secret: Buffer | string, expiresInSec = 3600): string {
  const secretBuf = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };

  const encHeader = b64url(JSON.stringify(header));
  const encBody = b64url(JSON.stringify(body));
  const data = `${encHeader}.${encBody}`;

  const sig = crypto.createHmac('sha256', secretBuf).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

/**
 * Create a valid auth cookie for testing
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {string} secretPath - Path to secret key file
 * @returns {string} Cookie string ready to use in requests
 */
export function createAuthCookie(userId: number, username: string, secretPath: string): string {
  const secret = fs.readFileSync(secretPath);
  const token = signTestJWT({ sub: userId, username }, secret);
  return `auth=${token}`;
}

/**
 * Create a test user via bootstrap
 * @param {Object} request - Supertest request object
 * @param {string} username - Username (will be made unique if not provided)
 * @param {string} password - Password
 * @returns {Promise<{cookie: string, user: Object}>}
 */
export async function bootstrapTestUser(request: SuperTest<Test> | Agent, username?: string, password = 'testpassword1234567') {
  // Generate unique username if not provided
  if (!username) {
    username = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  const res = await request
    .post('/api/auth/bootstrap')
    .send({ username, password, setupToken: accountSetupToken });

  // If already initialized, try to login instead
  if (res.status === 400 && res.body.error === 'Already initialized') {
    return loginTestUser(request, username, password);
  }

  if (res.status !== 200) {
    throw new Error(`Bootstrap failed: ${res.body.error || 'Unknown error'}`);
  }

  const cookies = res.get('set-cookie');
  const authCookie = Array.isArray(cookies) ? cookies[0]?.split(';')[0] ?? null : null;

  return {
    cookie: authCookie,
    user: res.body.user,
  };
}

/**
 * Login as an existing user
 * @param {Object} request - Supertest request object
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<{cookie: string, user: Object}>}
 */
export async function loginTestUser(request: SuperTest<Test> | Agent, username: string, password: string) {
  const res = await request
    .post('/api/auth/login')
    .send({ username, password });

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.body.error || 'Unknown error'}`);
  }

  const cookies = res.get('set-cookie');
  const authCookie = Array.isArray(cookies) ? cookies[0]?.split(';')[0] ?? null : null;

  return {
    cookie: authCookie,
    user: res.body.user,
  };
}
