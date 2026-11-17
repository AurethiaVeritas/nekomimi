import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureWritableDirectory, ensureWritableFileIfExists } from '../../server/storage';

const temporaryRoots: string[] = [];

function makeTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekomimi-storage-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('runtime storage permission checks', () => {
  it('creates a missing writable directory and removes its write probe', () => {
    const directory = path.join(makeTemporaryRoot(), 'data');

    ensureWritableDirectory(directory, 'data');

    expect(fs.statSync(directory).isDirectory()).toBe(true);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('reports a clear error when a required directory is not accessible', () => {
    const directory = makeTemporaryRoot();
    vi.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    expect(() => ensureWritableDirectory(directory, 'cover')).toThrow(
      /\[startup\] Required cover directory .* is not readable and writable by UID .*Check the ownership and permissions/,
    );
  });

  it('reports an existing persistent file that cannot be updated', () => {
    const filePath = path.join(makeTemporaryRoot(), 'settings.json');
    fs.writeFileSync(filePath, '{}');
    vi.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    expect(() => ensureWritableFileIfExists(filePath, 'settings file')).toThrow(
      /\[startup\] Required settings file .* is not readable and writable by UID/,
    );
  });
});
