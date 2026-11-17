import fs from 'node:fs';
import path from 'node:path';

function runtimeIdentity(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  const gid = typeof process.getgid === 'function' ? process.getgid() : 'unknown';
  return `UID ${uid}, GID ${gid}`;
}

function storagePermissionError(kind: string, targetPath: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `[startup] Required ${kind} "${targetPath}" is not readable and writable by ${runtimeIdentity()}. `
    + `Check the ownership and permissions of the host bind mount. Original error: ${detail}`,
  );
}

export function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

/**
 * Create a runtime directory when missing and verify the current process can
 * traverse, read, create, and remove files in it. The probe catches bind-mount
 * ownership problems that an image-layer chown cannot fix.
 */
export function ensureWritableDirectory(directory: string, label: string): void {
  const absolutePath = path.resolve(directory);

  try {
    ensureDirectory(absolutePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error('path exists but is not a directory');
    }
    fs.accessSync(absolutePath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    throw storagePermissionError(`${label} directory`, absolutePath, error);
  }

  const probePath = path.join(
    absolutePath,
    `.nekomimi-write-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  let descriptor: number | null = null;

  try {
    descriptor = fs.openSync(probePath, 'wx', 0o600);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.unlinkSync(probePath);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { }
    }
    try { fs.rmSync(probePath, { force: true }); } catch { }
    throw storagePermissionError(`${label} directory`, absolutePath, error);
  }
}

/** Verify an existing persistent file can be both read and updated. */
export function ensureWritableFileIfExists(filePath: string, label: string): void {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return;

  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error('path exists but is not a regular file');
    }
    fs.accessSync(absolutePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw storagePermissionError(label, absolutePath, error);
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}
