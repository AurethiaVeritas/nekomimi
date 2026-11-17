import fs from 'node:fs';
import path from 'node:path';
import { isAudioFile, guessMimeType, type ListedButInaccessiblePath } from '../filesystem/utils';
import type { DbMedia } from './db';
import { isPathWithinAllowed } from './pathGuard';

export const SMB_FILENAME_UNREACHABLE = 'SMB_FILENAME_UNREACHABLE';

export function describeInaccessibleSmbPath(issue: ListedButInaccessiblePath): string {
  const characters = issue.reservedCharacters.length > 0
    ? ` Its name contains character(s) that may be incompatible with this filesystem connection: ${issue.reservedCharacters.join(' ')}.`
    : '';
  const rename = issue.suggestedName !== issue.name
    ? ` Rename it at the storage source to "${issue.suggestedName}" (suggested path: ${issue.suggestedPath}),`
    : ' Rename it at the storage source or correct the share filename-encoding setting,';
  return `The directory "${issue.name}" appears in the mounted storage but cannot be opened.${characters}${rename} reconnect the storage, then run Align File Path again.`;
}

export function toAudioMediaFile(filePath: string): DbMedia {
  return {
    filename: path.basename(filePath),
    filepath: filePath,
    mime: guessMimeType(filePath),
  };
}

export function scanAudioMedia(mediaPath: string): { baseDir: string; media: DbMedia[] } {
  const stat = fs.lstatSync(mediaPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(mediaPath)
      .map(file => path.join(mediaPath, file))
      .filter(file => isPathWithinAllowed(file, [mediaPath]) && fs.lstatSync(file).isFile())
    : (stat.isFile() ? [mediaPath] : []);
  return {
    baseDir: stat.isDirectory() ? mediaPath : path.dirname(mediaPath),
    media: files.filter(isAudioFile).map(toAudioMediaFile),
  };
}

