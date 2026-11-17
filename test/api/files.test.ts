import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../../server/index';
import { upsertWork } from '../../server/db';
import { bootstrapTestUser } from '../helpers/auth';

describe('Library file delivery', () => {
  let cookie: string;
  let baseDir: string;
  const workId = 965432;

  beforeAll(async () => {
    const auth = await bootstrapTestUser(request(app), 'file-delivery-user');
    cookie = auth.cookie!;
    baseDir = path.join(process.env.DATA_DIR!, 'library');
    fs.mkdirSync(path.join(baseDir, '音声'), { recursive: true });
    const filenames = ['track.mp3', '100%.mp3', 'literal%20space.mp3', '音声/あ%25.mp3', 'document.pdf', 'empty.mp3'];
    for (const filename of filenames) {
      fs.writeFileSync(path.join(baseDir, filename), filename === 'empty.mp3' ? '' : '0123456789');
    }
    await upsertWork({
      id: workId,
      rjcode: String(workId),
      title: 'File delivery fixture',
      base_dir: baseDir,
      media: filenames.filter(filename => !filename.includes('/') && filename.endsWith('.mp3')).map(filename => ({
        filename,
        filepath: path.join(baseDir, filename),
        mime: 'audio/mpeg',
      })),
    });
  });

  it.each(['100%.mp3', 'literal%20space.mp3', '音声/あ%25.mp3'])('decodes the file path only once for %s', async filename => {
    const encoded = filename.split('/').map(encodeURIComponent).join('/');
    const res = await request(app).get(`/files/${workId}/${encoded}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(Buffer.from('0123456789'));
  });

  it('reports no parent at the library root and the root parent for a direct child', async () => {
    const root = await request(app).get(`/api/works/${workId}/files`).set('Cookie', cookie);
    expect(root.status).toBe(200);
    expect(root.body.parent).toBeNull();
    const child = await request(app).get(`/api/works/${workId}/files`).query({ p: '音声' }).set('Cookie', cookie);
    expect(child.status).toBe(200);
    expect(child.body.parent).toBeNull();
  });

  it.each(['files', 'media'])('preserves full and partial delivery through /%s', async route => {
    const url = `/${route}/${workId}/track.mp3`;
    const full = await request(app).get(url).set('Cookie', cookie);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('audio/mpeg');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.body).toEqual(Buffer.from('0123456789'));

    for (const [range, body, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'],
      ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-4', '6789', 'bytes 6-9/10'],
      ['bytes=8-99', '89', 'bytes 8-9/10'],
    ]) {
      const partial = await request(app).get(url).set('Cookie', cookie).set('Range', range);
      expect(partial.status).toBe(206);
      expect(partial.headers['content-range']).toBe(contentRange);
      expect(partial.headers['content-length']).toBe(String(body.length));
      expect(partial.body).toEqual(Buffer.from(body));
    }
    for (const range of ['bytes=10-', 'bytes=5-4', 'bytes=0-1,4-5', 'items=0-1']) {
      const invalid = await request(app).get(url).set('Cookie', cookie).set('Range', range);
      expect(invalid.status).toBe(416);
      expect(invalid.headers['content-range']).toBe('bytes */10');
    }
  });

  it.each(['files', 'media'])('handles empty files through /%s', async route => {
    const url = `/${route}/${workId}/empty.mp3`;
    const full = await request(app).get(url).set('Cookie', cookie);
    expect(full.status).toBe(200);
    expect(full.headers['content-length']).toBe('0');
    const partial = await request(app).get(url).set('Cookie', cookie).set('Range', 'bytes=0-');
    expect(partial.status).toBe(416);
    expect(partial.headers['content-range']).toBe('bytes */0');
  });

  it('keeps PDFs inline and rejects escaped paths and malformed URL encoding', async () => {
    const pdf = await request(app).get(`/files/${workId}/document.pdf`).set('Cookie', cookie);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toBe('inline');
    const escaped = await request(app).get(`/files/${workId}/..%2Foutside.mp3`).set('Cookie', cookie);
    expect(escaped.status).toBe(404);
    const malformed = await request(app).get(`/files/${workId}/broken%ZZ.mp3`).set('Cookie', cookie);
    expect(malformed.status).toBe(400);
  });
});
