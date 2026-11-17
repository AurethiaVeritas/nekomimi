import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../../server/index';
import { initializeAccountSetup } from '../../server/auth';

function restartSetup(): string | undefined {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    initializeAccountSetup();
    return String(output.mock.calls.at(-1)?.[0] ?? '').match(/Account setup token: ([a-f0-9]{64})/)?.[1];
  } finally {
    output.mockRestore();
  }
}

describe('Account setup lifecycle', () => {
  const usersPath = path.join(process.env.DATA_DIR!, 'users.json');
  const credentials = { username: 'setup-lifecycle', password: 'setup-password-123' };

  it.each([undefined, '', 'wrong', 123, {}, 'あ'.repeat(64)])('rejects setup verification token %j', async (setupToken) => {
    const res = await request(app).post('/api/auth/setup-token').send({ setupToken });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('verifies without creating a session or consuming the token and rechecks after restart', async () => {
    const setupToken = restartSetup();
    const res = await request(app).post('/api/auth/setup-token').send({ setupToken });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(fs.readFileSync(usersPath, 'utf8')).users).toEqual([]);
    expect((await request(app).post('/api/auth/setup-token').send({ setupToken })).status).toBe(200);
    expect((await request(app).post('/api/auth/bootstrap').send(credentials)).status).toBe(403);
    restartSetup();
    expect((await request(app).post('/api/auth/setup-token').send({ setupToken })).status).toBe(403);
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken })).status).toBe(403);
  });

  it('rotates on restart, preserves token after bad credentials, and consumes it on success', async () => {
    const oldToken = restartSetup();
    const setupToken = restartSetup();
    expect(setupToken).toMatch(/^[a-f0-9]{64}$/);
    expect(setupToken).not.toBe(oldToken);
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken: oldToken })).status).toBe(403);
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, password: 'short', setupToken })).status).toBe(400);
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken })).status).toBe(200);
    expect((await request(app).post('/api/auth/setup-token').send({ setupToken })).status).toBe(400);
    expect(restartSetup()).toBeUndefined();
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken })).status).toBe(400);
    fs.writeFileSync(usersPath, JSON.stringify({ users: [] }));
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken })).status).toBe(403);
  });

  it.each(['null', '{}', '{"users":null}', '{"users":[null,{}, {"id":1,"username":"broken","pass":{}}]}', 'invalid json'])('allows protected recovery from unusable storage %s', async (store) => {
    fs.writeFileSync(usersPath, store);
    const setupToken = restartSetup();
    expect(setupToken).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(app).post('/api/auth/bootstrap').send(credentials)).status).toBe(403);
    expect((await request(app).post('/api/auth/bootstrap').send({ ...credentials, setupToken })).status).toBe(200);
  });
});
