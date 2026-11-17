import crypto from 'node:crypto';
import { signTestJWT } from '../helpers/auth';

describe('Auth Helper Unit Tests', () => {
  describe('signTestJWT', () => {
    const secret = crypto.randomBytes(32);

    it('should generate a valid JWT token', () => {
      const payload = { sub: 1, username: 'testuser' };
      const token = signTestJWT(payload, secret);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include payload data in token', () => {
      const payload = { sub: 1, username: 'testuser' };
      const token = signTestJWT(payload, secret);

      const parts = token.split('.');
      const payloadStr = Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8');
      const decoded = JSON.parse(payloadStr);

      expect(decoded.sub).toBe(1);
      expect(decoded.username).toBe('testuser');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should set expiration time correctly', () => {
      const payload = { sub: 1, username: 'testuser' };
      const expiresIn = 7200; // 2 hours
      const token = signTestJWT(payload, secret, expiresIn);

      const parts = token.split('.');
      const payloadStr = Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8');
      const decoded = JSON.parse(payloadStr);

      expect(decoded.exp - decoded.iat).toBe(expiresIn);
    });
  });
});
