import { Router, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getWork } from './db';
import { requireAuth } from './auth';
import { getAllowedRoots, isPathWithinAllowed } from './pathGuard';
import { openRegularFileNoFollow, streamOpenedFile } from './httpSecurity';
import { toStringParam } from './requestUtils';
import { SMB_FILENAME_UNREACHABLE, describeInaccessibleSmbPath } from './libraryMedia';
import { inspectListedButInaccessiblePath, guessMimeType, isAudioFile, isImageFile, isVideoFile, isPdfFile } from '../filesystem/utils';

const router = Router();

function resolveUnderBase(baseDir: string, rel = ''): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, rel);
  return isPathWithinAllowed(target, [base]) ? target : null;
}

function sendMissingPath(res: Response, currentPath: string, missingPath: string, message: string) {
  const issue = inspectListedButInaccessiblePath(missingPath);
  if (!issue) return res.status(404).json({ error: message });
  return res.status(409).json({
    error: describeInaccessibleSmbPath(issue),
    code: SMB_FILENAME_UNREACHABLE,
    currentPath,
    inaccessiblePath: issue.path,
    suggestedPath: issue.suggestedPath,
  });
}

// List files under a work's base directory
// GET /api/works/:id/files?p=relative/subdir
router.get('/api/works/:id/files', async (req, res) => {
  const w = await getWork(req.params.id);
  if (!w?.base_dir) return res.status(404).json({ error: 'Base directory not found' });
  if (!fs.existsSync(w.base_dir)) {
    return sendMissingPath(res, w.base_dir, w.base_dir, 'Base directory not found');
  }
  const allowedRoots = await getAllowedRoots();
  const baseDir = w.base_dir;
  if (!isPathWithinAllowed(baseDir, allowedRoots)) {
    return res.status(403).json({ error: 'Work path is outside allowed library directories. Update settings to include it.' });
  }
  const rel = (req.query.p || '').toString();
  const abs = resolveUnderBase(baseDir, rel);
  if (!abs) return res.status(404).json({ error: 'Path not found' });
  if (!fs.existsSync(abs)) {
    return sendMissingPath(res, w.base_dir, abs, 'Path not found');
  }
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.') && isPathWithinAllowed(path.join(abs, d.name), [baseDir]));
  const items = entries.map(d => {
    const full = path.join(abs, d.name);
    const s = fs.statSync(full);
    const isDir = s.isDirectory();
    const relPath = path.relative(baseDir, full);
    return {
      name: d.name,
      isDir,
      size: s.size,
      mtime: s.mtimeMs,
      relPath,
      mime: isDir ? null : guessMimeType(full),
      isAudio: isDir ? false : isAudioFile(full),
      isImage: isDir ? false : isImageFile(full),
      isVideo: isDir ? false : isVideoFile(full),
      isPdf: isDir ? false : isPdfFile(full),
    };
  }).sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));

  const parent = abs === path.resolve(baseDir) ? '' : path.relative(baseDir, path.dirname(abs));
  res.json({ base: w.base_dir, path: rel, parent: parent === '' ? null : parent, items });
});

// Serve arbitrary file under a work's base directory with Range support
// GET /files/:id/:filePath
router.get(/^\/files\/([^/]+)(?:\/(.*))?$/, requireAuth, async (req, res) => {
  const workId = req.params[0];
  const filePathParam = req.params[1] || '';
  const w = await getWork(workId);
  if (!w?.base_dir) return res.status(404).end();
  const allowedRoots = await getAllowedRoots();
  if (!isPathWithinAllowed(w.base_dir, allowedRoots)) {
    return res.status(403).json({ error: 'Work path is outside allowed library directories. Update settings to include it.' });
  }
  // Express has already decoded regex parameters, including literal percent signs.
  const rel = toStringParam(filePathParam) || '';
  const abs = resolveUnderBase(w.base_dir, rel);
  if (!abs) return res.status(404).end();
  let opened: { fd: number; stat: fs.Stats };
  try {
    opened = openRegularFileNoFollow(abs, [w.base_dir]);
  } catch {
    return res.status(404).end();
  }
  streamOpenedFile(req, res, opened, guessMimeType(abs));
});

// Stream audio with Range support
router.get('/media/:id/:filename', requireAuth, async (req, res) => {
  const workId = toStringParam(req.params.id);
  if (!workId) return res.status(400).json({ error: 'Missing id' });
  const w = await getWork(workId);
  if (!w) return res.status(404).end();
  const allowedRoots = await getAllowedRoots();
  if (w.base_dir && !isPathWithinAllowed(w.base_dir, allowedRoots)) {
    return res.status(403).json({ error: 'Work path is outside allowed library directories. Update settings to include it.' });
  }

  // Express decodes URL-encoded segments; compare by filename text
  const reqName = toStringParam(req.params.filename);
  if (!reqName) return res.status(404).end();
  const item = (w.media || []).find(m => m.filename === reqName);
  if (!item || !fs.existsSync(item.filepath)) return res.status(404).end();
  if (!isPathWithinAllowed(item.filepath, allowedRoots)
    || (w.base_dir && !isPathWithinAllowed(item.filepath, [w.base_dir]))) {
    return res.status(403).json({ error: 'Media file is outside allowed library directories. Update settings to include it.' });
  }

  let opened: { fd: number; stat: fs.Stats };
  try {
    opened = openRegularFileNoFollow(item.filepath, w.base_dir ? [w.base_dir] : allowedRoots);
  } catch {
    return res.status(404).end();
  }
  streamOpenedFile(req, res, opened, item.mime || 'audio/mpeg');
});

export default router;
