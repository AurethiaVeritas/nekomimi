import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Express, NextFunction, Request, Response } from 'express';
import { resolvePathSafe } from '../filesystem/utils';
import { config } from '../config';
import type { AuthUser } from './types';
import { ensureDirectory, readJsonFile, writeJsonFile } from './storage';

const DATA_DIR = resolvePathSafe(config.dataDir);
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SECRET_PATH = path.join(DATA_DIR, 'secret.key');
const TOKEN_COOKIE = 'auth';
let setupToken: string | null = null;

// Initialize once at startup, before accepting requests. Never persist or expose over HTTP.
export function initializeAccountSetup(): void {
  setupToken = readUsers().users.length === 0 ? crypto.randomBytes(32).toString('hex') : null;
  if (setupToken) process.stdout.write(`[startup] Account setup token: ${setupToken}\n`);
}

interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
  digest: string;
  keylen: number;
}

interface StoredUser {
  id: number;
  username: string;
  pass: PasswordRecord;
  sessionVersion: number;
}

interface UserStore {
  users: StoredUser[];
}

type JwtPayload = {
  sub?: number;
  username?: string;
  exp?: number;
  iat?: number;
  ver?: number;
} & Record<string, unknown>;

// Rate limiter for authentication endpoints: 5 attempts per 15 minutes
// Disabled in test environment to avoid interfering with tests
const noopLimiter: RateLimitRequestHandler = ((_req: Request, _res: Response, next: NextFunction) => next()) as RateLimitRequestHandler;

const authLimiter: RateLimitRequestHandler = process.env.NODE_ENV === 'test'
  ? noopLimiter
  : rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
  });

function ensureDataFiles(): void {
  ensureDirectory(DATA_DIR);
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify({ users: [] }), { mode: 0o600 });
  if (!fs.existsSync(SECRET_PATH)) fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32), { mode: 0o600 });
  if (process.platform !== 'win32') {
    for (const filePath of [USERS_PATH, SECRET_PATH]) {
      if ((fs.statSync(filePath).mode & 0o777) !== 0o600) fs.chmodSync(filePath, 0o600);
    }
  }
}

function readUsers(): UserStore {
  ensureDataFiles();
  const store = readJsonFile<UserStore>(USERS_PATH, { users: [] });
  let migrated = false;
  const users = Array.isArray(store?.users) ? store.users.flatMap(user => {
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0
      || typeof user.username !== 'string' || user.username.length < 3
      || !user.pass || typeof user.pass.salt !== 'string' || Buffer.from(user.pass.salt, 'base64').length === 0
      || typeof user.pass.hash !== 'string'
      || !Number.isSafeInteger(user.pass.iterations) || user.pass.iterations <= 0
      || !Number.isSafeInteger(user.pass.keylen) || user.pass.keylen <= 0
      || typeof user.pass.digest !== 'string' || !crypto.getHashes().includes(user.pass.digest)
      || Buffer.from(user.pass.hash, 'base64').length !== user.pass.keylen) return [];
    if (!Number.isSafeInteger(user.sessionVersion) || user.sessionVersion <= 0) {
      user.sessionVersion = 1;
      migrated = true;
    }
    return [user];
  }) : [];
  if (migrated) writeJsonFile(USERS_PATH, { users });
  return { users };
}

function writeUsers(db: UserStore): void {
  ensureDataFiles();
  writeJsonFile(USERS_PATH, db);
}

function getSecret(): Buffer {
  ensureDataFiles();
  return fs.readFileSync(SECRET_PATH);
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function signJWT(payload: Record<string, unknown>, expiresInSec = 60 * 60 * 24 * 7): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const encHeader = b64url(JSON.stringify(header));
  const encBody = b64url(JSON.stringify(body));
  const data = `${encHeader}.${encBody}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function verifyJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;
    const data = `${h}.${p}`;
    const expSig = crypto.createHmac('sha256', getSecret()).update(data).digest();
    const gotSig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (!crypto.timingSafeEqual(expSig, gotSig)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8')) as JwtPayload;
    if (!payload || !Number.isSafeInteger(payload.exp) || Math.floor(Date.now() / 1000) >= payload.exp!) return null;
    if (!Number.isSafeInteger(payload.sub) || payload.sub! <= 0) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password: string, salt = crypto.randomBytes(16)): PasswordRecord {
  const iterations = 210000;
  const keylen = 64;
  const digest = 'sha512';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), iterations, digest, keylen };
}

function verifyPassword(password: string, record: PasswordRecord): boolean {
  try {
    const salt = Buffer.from(record.salt, 'base64');
    const hash = crypto.pbkdf2Sync(password, salt, record.iterations, record.keylen, record.digest);
    const stored = Buffer.from(record.hash, 'base64');
    return crypto.timingSafeEqual(hash, stored);
  } catch { return false; }
}

function parseCookies(req: Request): Record<string, string> {
  const h = req.headers.cookie || '';
  const out: Record<string, string> = Object.create(null);
  h.split(/;\s*/).forEach(p => {
    const i = p.indexOf('='); if (i === -1) return;
    try {
      const k = decodeURIComponent(p.slice(0, i));
      const v = decodeURIComponent(p.slice(i + 1));
      out[k] = v;
    } catch {
      // Ignore malformed cookies instead of failing every route with URIError.
    }
  });
  return out;
}

function setAuthCookie(res: Response, token: string): void {
  // Only set Secure when explicitly requested; many deployments are HTTP-only behind LAN/dev
  const secure = (process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true');
  const attrs = [
    `${TOKEN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict', // Changed from Lax to Strict for CSRF protection
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearAuthCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// Middleware to attach user if token is present and valid
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const cookies = parseCookies(req);
  const token = cookies[TOKEN_COOKIE];
  if (token) {
    const payload = verifyJWT(token);
    if (payload && typeof payload.sub === 'number' && Number.isSafeInteger(payload.ver)) {
      const user = readUsers().users.find(candidate => (
        candidate.id === payload.sub && candidate.sessionVersion === payload.ver
      ));
      if (user) req.user = { id: user.id, username: user.username };
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireSetupToken(req: Request, res: Response): boolean {
  const suppliedToken = req.body?.setupToken;
  if (!setupToken || typeof suppliedToken !== 'string'
    || !/^[a-f0-9]{64}$/.test(suppliedToken)
    || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(setupToken))) {
    res.status(403).json({ error: 'Invalid or missing setup token. Use the token from the server terminal.' });
    return false;
  }
  return true;
}

// Routes factory
export function mountAuthRoutes(app: Express): void {
  app.get('/api/auth/me', attachUser, (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ user: null });
    res.json({ user: req.user });
  });

  app.post('/api/auth/setup-token', authLimiter, (req: Request, res: Response) => {
    if (readUsers().users.length > 0) return res.status(400).json({ error: 'Already initialized' });
    if (!requireSetupToken(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  app.post('/api/auth/bootstrap', authLimiter, (req: Request, res: Response) => {
    const db = readUsers();
    if (db.users.length > 0) return res.status(400).json({ error: 'Already initialized' });
    if (!requireSetupToken(req, res)) return;
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
    if (String(username).length < 3) return res.status(400).json({ error: 'Username too short' });
    if (String(password).length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
    const pass = hashPassword(String(password));
    const user: StoredUser = { id: 1, username: String(username), pass, sessionVersion: 1 };
    db.users.push(user);
    writeUsers(db);
    setupToken = null;
    const token = signJWT({ sub: user.id, username: user.username, ver: user.sessionVersion });
    setAuthCookie(res, token);
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/login', authLimiter, (req: Request, res: Response) => {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
    const db = readUsers();
    const user = db.users.find(u => u.username === String(username));
    if (!user || !verifyPassword(String(password), user.pass)) {
      console.warn(`Login failed for user: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signJWT({ sub: user.id, username: user.username, ver: user.sessionVersion });
    setAuthCookie(res, token);
    console.log(`User logged in: ${username}`);
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    // Try to identify user before clearing cookie for logging
    const cookies = parseCookies(req);
    const token = cookies[TOKEN_COOKIE];
    let username: string | undefined = 'unknown';
    if (token) {
      const payload = verifyJWT(token);
      if (payload && typeof payload.username === 'string') {
        username = payload.username;
        const db = readUsers();
        const user = db.users.find(candidate => (
          candidate.id === payload.sub && candidate.sessionVersion === payload.ver
        ));
        if (user) {
          user.sessionVersion += 1;
          writeUsers(db);
        }
      }
    }
    clearAuthCookie(res);
    console.log(`User logged out: ${username}`);
    res.json({ ok: true });
  });

  // Change password for current user
  app.post('/api/auth/change-password', authLimiter, attachUser, (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    const db = readUsers();
    const user = db.users.find(u => u.id === req.user!.id);
    if (!user || !verifyPassword(currentPassword, user.pass)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    if (newPassword.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters' });
    }
    user.pass = hashPassword(newPassword);
    user.sessionVersion += 1;
    writeUsers(db);
    const token = signJWT({ sub: user.id, username: user.username, ver: user.sessionVersion });
    setAuthCookie(res, token);
    res.json({ ok: true });
  });
}

export type { AuthUser };
