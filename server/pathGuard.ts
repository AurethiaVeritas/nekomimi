import fs from 'node:fs';
import path from 'node:path';
import { isPathUnderRoot, resolvePathSafe } from '../filesystem/utils';
import { config } from '../config';
import { getSettings } from './settings';
import type { Settings } from './types';

export const staticRoots = [
  resolvePathSafe(config.dataDir),
  resolvePathSafe(config.coverDir),
];

const normalize = (p: string): string => path.resolve(p);

function canonicalize(p: string): string {
  const absolute = normalize(p);
  let existing = absolute;
  const missing: string[] = [];

  while (true) {
    try {
      const resolved = fs.realpathSync.native(existing);
      return path.resolve(resolved, ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) return absolute;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const lexicalRoot = normalize(root);
  const lexicalTarget = normalize(target);
  if (!isPathUnderRoot(lexicalTarget, lexicalRoot)) return false;

  const relativeParts = path.relative(lexicalRoot, lexicalTarget).split(path.sep).filter(Boolean);
  let current = lexicalRoot;
  for (const part of relativeParts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') break;
      throw error;
    }
  }

  return isPathUnderRoot(canonicalize(target), canonicalize(root));
}

export async function getAllowedRoots(): Promise<string[]> {
  const settings: Settings = await getSettings();
  const userPaths: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    userPaths.push(resolvePathSafe(trimmed));
  };
  if (Array.isArray(settings.defaultScanPaths)) {
    for (const p of settings.defaultScanPaths) push(p);
  }
  const normalized = [...staticRoots, ...userPaths].map(normalize);
  const deduped = Array.from(new Set(normalized));
  return deduped;
}

export function isPathWithinAllowed(absPath: string, allowedRoots: string[]): boolean {
  const norm = normalize(absPath);
  return allowedRoots.some(root => isWithin(root, norm));
}

export interface EnsurePathOptions {
  allowedRoots?: string[];
  statusCode?: number;
  message?: string;
}

export async function ensurePathAllowed(absPath: string, options: EnsurePathOptions = {}): Promise<string> {
  const allowedRoots = options.allowedRoots || await getAllowedRoots();
  if (isPathWithinAllowed(absPath, allowedRoots)) return absPath;
  const msg = options.message || `Path ${absPath} is not within allowed library directories.`;
  const err: NodeJS.ErrnoException & { statusCode?: number } = new Error(msg);
  err.code = 'PATH_NOT_ALLOWED';
  if (options.statusCode) err.statusCode = options.statusCode;
  throw err;
}
