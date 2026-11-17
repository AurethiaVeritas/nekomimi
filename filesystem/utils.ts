// Filesystem and formatting helpers used by scrapers and server

import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_RESERVED_FILENAME_REPLACEMENTS = new Map([
  ['"', '＂'],
  ['*', '＊'],
  [':', '：'],
  ['<', '＜'],
  ['>', '＞'],
  ['?', '？'],
  ['/', '／'],
  ['\\', '＼'],
  ['|', '｜'],
]);

export type ListedButInaccessiblePath = {
  path: string;
  name: string;
  reservedCharacters: string[];
  suggestedName: string;
  suggestedPath: string;
};

type PathInspectionOps = {
  existsSync: (targetPath: string) => boolean;
  readdirSync: (targetPath: string) => string[];
};

const defaultPathInspectionOps: PathInspectionOps = {
  existsSync: targetPath => fs.existsSync(targetPath),
  readdirSync: targetPath => fs.readdirSync(targetPath, { encoding: 'utf8' }),
};

export function getWindowsReservedFilenameCharacters(name: string): string[] {
  return Array.from(new Set(Array.from(name).filter(character => WINDOWS_RESERVED_FILENAME_REPLACEMENTS.has(character))));
}

export function toWindowsSafeFilename(name: string): string {
  return Array.from(name)
    .map(character => WINDOWS_RESERVED_FILENAME_REPLACEMENTS.get(character) ?? character)
    .join('');
}

// Some SMB servers can enumerate a directory entry but macOS cannot stat or open
// it when its name contains a Windows-reserved character. Walk up to the nearest
// accessible parent so callers can distinguish that case from a genuinely missing
// path without attempting a destructive rename through an unaddressable path.
export function inspectListedButInaccessiblePath(
  targetPath: string,
  ops: PathInspectionOps = defaultPathInspectionOps,
): ListedButInaccessiblePath | null {
  let currentPath = path.resolve(targetPath);
  if (ops.existsSync(currentPath)) return null;

  while (true) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) return null;

    if (ops.existsSync(parentPath)) {
      let entries: string[];
      try {
        entries = ops.readdirSync(parentPath);
      } catch {
        return null;
      }

      const expectedName = path.basename(currentPath);
      const normalizedExpectedName = expectedName.normalize('NFC');
      const listedName = entries.find(entry => (
        entry === expectedName || entry.normalize('NFC') === normalizedExpectedName
      ));
      if (!listedName) return null;

      const reservedCharacters = getWindowsReservedFilenameCharacters(listedName);
      if (reservedCharacters.length === 0) return null;
      const suggestedName = toWindowsSafeFilename(listedName);
      return {
        path: currentPath,
        name: listedName,
        reservedCharacters,
        suggestedName,
        suggestedPath: path.join(parentPath, suggestedName),
      };
    }

    currentPath = parentPath;
  }
}

// Format a DLsite work id to RJ numeric string.
// DLsite RJ numbers can be 6 or 8 digits (not 7).
// Normalization rules:
// - If < 6 digits, left-pad to 6
// - If 6 digits, keep
// - If 7 digits, left-pad to 8 (e.g., 1332445 -> 01332445)
// - If 8 digits, keep
// - If > 8 digits, keep last 8
export function formatID(id: string | number): string {
  const n = String(id).replace(/[^0-9]/g, '');
  if (!n) return '';
  if (n.length <= 6) return n.padStart(6, '0');
  if (n.length === 7) return n.padStart(8, '0');
  if (n.length === 8) return n;
  // Unexpected longer input; keep last 8 to be safe
  return n.slice(-8);
}

// Resolve a path within the project workspace safely
export function resolvePathSafe(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts);
}

// Lexical containment only. Callers serving files must also use pathGuard's
// canonical and symlink checks before opening them.
export function isPathUnderRoot(target: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

// Recognized audio file extensions
export const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus']);
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov']);
export const PDF_EXTS = new Set(['.pdf']);

function hasExtension(filePath: string, extensions: Set<string>): boolean {
  return extensions.has(path.extname(filePath).toLowerCase());
}

export function isAudioFile(filePath: string): boolean {
  return hasExtension(filePath, AUDIO_EXTS);
}

export function isImageFile(filePath: string): boolean {
  return hasExtension(filePath, IMAGE_EXTS);
}

export function isVideoFile(filePath: string): boolean {
  return hasExtension(filePath, VIDEO_EXTS);
}

export function isPdfFile(filePath: string): boolean {
  return hasExtension(filePath, PDF_EXTS);
}

// Best-effort MIME guesser to avoid external dependency issues
export function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.flac': return 'audio/flac';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.opus': return 'audio/opus';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    case '.mov': return 'video/quicktime';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

// Extract RJ numeric id (6-8 digits) from a name like "RJ123456", "123456", "01234567".
// Returns the numeric string without prefix or null if not a pure RJ-like name.
export function extractRJFromName(name: string): string | null {
  let n = String(name).trim();
  // Allow hidden names that start with dots, e.g. ".RJ01332445" or ".01332445"
  n = n.replace(/^\.+/, '');
  let m = /^RJ((?:\d{6}|\d{8}))$/i.exec(n);
  if (m) return m[1];
  m = /^((?:\d{6}|\d{8}))$/.exec(n);
  if (m) return m[1];
  return null;
}
