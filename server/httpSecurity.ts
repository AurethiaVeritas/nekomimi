import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { isPathWithinAllowed } from './pathGuard';

export type ByteRange = { start: number; end: number };

export function parseSingleByteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
    || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function openRegularFileNoFollow(filePath: string, allowedRoots?: string[]): { fd: number; stat: fs.Stats } {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      const error = new Error('Not a regular file') as NodeJS.ErrnoException;
      error.code = 'EINVAL';
      throw error;
    }
    if (allowedRoots) {
      const current = fs.lstatSync(filePath);
      if (!current.isFile() || current.isSymbolicLink()
        || current.dev !== stat.dev || current.ino !== stat.ino
        || !isPathWithinAllowed(filePath, allowedRoots)) {
        const error = new Error('File changed or escaped its allowed root while opening') as NodeJS.ErrnoException;
        error.code = 'PATH_NOT_ALLOWED';
        throw error;
      }
    }
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

export function streamFileDescriptor(
  req: Request,
  res: Response,
  fd: number,
  range?: ByteRange,
): void {
  const stream = fs.createReadStream('', {
    fd,
    autoClose: true,
    ...(range ? { start: range.start, end: range.end } : {}),
  });
  let settled = false;
  const destroy = () => {
    if (!settled) stream.destroy();
  };
  req.on('aborted', destroy);
  res.on('close', destroy);
  stream.on('close', () => {
    settled = true;
    req.off('aborted', destroy);
    res.off('close', destroy);
  });
  stream.on('error', (error) => {
    if (res.headersSent) res.destroy(error);
    else res.status(500).json({ error: 'Failed to stream file' });
  });
  stream.pipe(res);
}

// Takes ownership of the open descriptor, closing it for rejected ranges or
// passing it to the stream, which closes it on completion or disconnect.
export function streamOpenedFile(
  req: Request,
  res: Response,
  opened: { fd: number; stat: fs.Stats },
  mimeType: string,
): void {
  const { fd, stat } = opened;
  const rangeHeader = req.headers.range;
  const range = rangeHeader ? parseSingleByteRange(rangeHeader, stat.size) : undefined;
  if (range === null) {
    fs.closeSync(fd);
    res.set('Content-Range', `bytes */${stat.size}`);
    res.status(416).end();
    return;
  }

  if (mimeType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "sandbox; script-src 'none'");
  if (mimeType === 'application/pdf') res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', range ? range.end - range.start + 1 : stat.size);
  if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
  res.status(range ? 206 : 200);
  streamFileDescriptor(req, res, fd, range);
}

export type ImageExtension = '.jpg' | '.jpeg' | '.png' | '.webp';

export function detectImageExtension(header: Buffer): ImageExtension | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return '.jpg';
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

export function imageExtensionMatches(expected: ImageExtension, detected: ImageExtension): boolean {
  return (expected === '.jpeg' ? '.jpg' : expected) === detected;
}

export class UploadError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export function receiveValidatedImage(
  req: Request,
  destination: string,
  expectedExtension: ImageExtension,
  maxBytes: number,
): Promise<void> {
  const stage = `${destination}.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(stage, { flags: 'wx', mode: 0o600 });
    let bytes = 0;
    let header = Buffer.alloc(0);
    let finished = false;

    const cleanup = () => {
      try { fs.unlinkSync(stage); } catch { }
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      req.unpipe(output);
      req.resume();
      output.destroy();
      cleanup();
      reject(error);
    };

    req.on('aborted', () => fail(new UploadError('Upload aborted', 400)));
    req.on('error', error => fail(error));
    output.on('error', error => fail(error));
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (header.length < 16) header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
      if (bytes > maxBytes) fail(new UploadError(`Cover exceeds the ${maxBytes}-byte limit`, 413));
    });
    output.on('finish', () => {
      if (finished) return;
      if (bytes === 0) return fail(new UploadError('Cover body is empty', 400));
      const detected = detectImageExtension(header);
      if (!detected || !imageExtensionMatches(expectedExtension, detected)) {
        return fail(new UploadError('Cover content does not match its supported image extension', 400));
      }
      try {
        fs.renameSync(stage, destination);
        finished = true;
        resolve();
      } catch (error) {
        fail(error as Error);
      }
    });
    req.pipe(output);
  });
}

export function readValidatedImage(filePath: string, maxBytes: number, allowedRoots?: string[]): { body: Buffer; extension: ImageExtension } {
  const { fd, stat } = openRegularFileNoFollow(filePath, allowedRoots);
  try {
    if (stat.size <= 0) throw new UploadError('Cover is not a non-empty regular file', 400);
    if (stat.size > maxBytes) throw new UploadError(`Cover exceeds the ${maxBytes}-byte limit`, 413);
    const body = fs.readFileSync(fd);
    const extension = detectImageExtension(body);
    if (!extension) throw new UploadError('Cover content is not a supported image', 400);
    return { body, extension };
  } finally {
    fs.closeSync(fd);
  }
}

export function writeFileAtomically(destination: string, body: Buffer): void {
  const stage = `${destination}.write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(stage, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(stage, destination);
  } catch (error) {
    try { fs.unlinkSync(stage); } catch { }
    throw error;
  }
}

export function isAllowedRemoteCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return ['dlsite.com', 'dlsite.jp', 'asmr-200.com'].some(domain => (
      hostname === domain || hostname.endsWith(`.${domain}`)
    ));
  } catch {
    return false;
  }
}

export function cleanupExpiredCoverFiles(directory: string, olderThanMs: number): void {
  const cutoff = Date.now() - olderThanMs;
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith('temp-') && !name.includes('.upload-') && !name.includes('.write-')) continue;
    const target = path.join(directory, name);
    try {
      const stat = fs.lstatSync(target);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(target);
    } catch { }
  }
}
