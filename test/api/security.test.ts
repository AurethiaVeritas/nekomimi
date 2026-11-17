import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { bootstrapTestUser, signTestJWT } from '../helpers/auth';

describe('Security regressions', () => {
  let cookie: string;
  let secret: Buffer;
  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app), 'security-audit-user');
    cookie = auth.cookie!;
    secret = fs.readFileSync(path.join(process.env.DATA_DIR!, 'secret.key'));
  });

  it('ignores malformed cookies while preserving valid authentication', async () => {
    expect((await request(app).get('/api/health').set('Cookie', 'broken=%')).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'auth=%')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', `broken=%; ${cookie}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set('Cookie', 'broken=%')).status).toBe(200);
  });

  it('rejects extra JWT segments and tokens at their expiration boundary', async () => {
    expect((await request(app).get('/api/auth/me').set('Cookie', `${cookie}.extra`)).status).toBe(401);
    const expired = signTestJWT({ sub: 1, username: 'security-audit-user' }, secret, 0);
    expect((await request(app).get('/api/auth/me').set('Cookie', `auth=${expired}`)).status).toBe(401);
  });

  it.each([
    [{ alg: 'none', typ: 'JWT' }, { sub: 1, exp: 9999999999 }],
    [{ alg: 'HS256', typ: 'JWT' }, { sub: 1 }],
    [{ alg: 'HS256', typ: 'JWT' }, { sub: 1, exp: '9999999999' }],
    [{ alg: 'HS256', typ: 'JWT' }, { sub: -1, exp: 9999999999 }],
  ])('rejects correctly signed but invalid JWT claims/header %j %j', async (header, payload) => {
    const data = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const token = `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
    expect((await request(app).get('/api/auth/me').set('Cookie', `auth=${token}`)).status).toBe(401);
  });

  it('creates and normalizes auth files without group or world permissions on POSIX', async () => {
    if (process.platform === 'win32') return;
    for (const name of ['secret.key', 'users.json']) {
      fs.chmodSync(path.join(process.env.DATA_DIR!, name), 0o644);
    }
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    for (const name of ['secret.key', 'users.json']) {
      expect(fs.statSync(path.join(process.env.DATA_DIR!, name)).mode & 0o777).toBe(0o600);
    }
  });

  it('sandboxes SVG covers and library files without disabling image delivery', async () => {
    const svgPath = path.join(process.env.COVER_DIR!, 'security.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const work = await upsertWork({ id: 989898, rjcode: '989898', title: 'Security fixture', cover_path: svgPath, base_dir: process.env.COVER_DIR! });
    for (const url of [`/cover/${work!.id}`, `/files/${work!.id}/security.svg`]) {
      const res = await request(app).get(url).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toBe("sandbox; script-src 'none'");
    }
  });

  it('does not follow library or cover symlinks outside their configured root', async () => {
    if (process.platform === 'win32') return;
    const outside = path.join('/tmp', `nekomimi-security-outside-${process.env.VITEST_WORKER_ID || '0'}.mp3`);
    const libraryLink = path.join(process.env.COVER_DIR!, 'outside-link.mp3');
    const coverLink = path.join(process.env.COVER_DIR!, 'outside-cover.jpg');
    fs.writeFileSync(outside, 'private-data');
    fs.symlinkSync(outside, libraryLink);
    fs.symlinkSync(outside, coverLink);
    try {
      const work = await upsertWork({
        id: 979797,
        rjcode: '979797',
        title: 'Symlink fixture',
        base_dir: process.env.COVER_DIR!,
        cover_path: coverLink,
        media: [{ filename: 'outside-link.mp3', filepath: libraryLink, mime: 'audio/mpeg' }],
      });
      expect((await request(app).get(`/cover/${work!.id}`).set('Cookie', cookie)).status).toBe(403);
      expect((await request(app).get(`/files/${work!.id}/outside-link.mp3`).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).get(`/media/${work!.id}/outside-link.mp3`).set('Cookie', cookie)).status).toBe(403);
      const listing = await request(app).get(`/api/works/${work!.id}/files`).set('Cookie', cookie);
      expect(listing.status).toBe(200);
      expect(listing.body.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'outside-link.mp3' })]));
    } finally {
      fs.unlinkSync(libraryLink);
      fs.unlinkSync(coverLink);
      fs.unlinkSync(outside);
    }
  });

  it('supports bounded single byte ranges and rejects malformed ranges', async () => {
    const filePath = path.join(process.env.COVER_DIR!, 'range-fixture.bin');
    fs.writeFileSync(filePath, '0123456789');
    const work = await upsertWork({ id: 969696, rjcode: '969696', title: 'Range fixture', base_dir: process.env.COVER_DIR! });

    const suffix = await request(app)
      .get(`/files/${work!.id}/range-fixture.bin`)
      .set('Cookie', cookie)
      .set('Range', 'bytes=-4');
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe('bytes 6-9/10');
    expect(suffix.headers['content-length']).toBe('4');

    for (const range of ['bytes=10-', 'bytes=5-4', 'bytes=0-1,4-5', 'items=0-1']) {
      const invalid = await request(app)
        .get(`/files/${work!.id}/range-fixture.bin`)
        .set('Cookie', cookie)
        .set('Range', range);
      expect(invalid.status).toBe(416);
      expect(invalid.headers['content-range']).toBe('bytes */10');
    }
  });
});
