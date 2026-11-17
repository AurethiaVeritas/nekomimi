import fs from 'node:fs';
import path from 'node:path';
import {
  resolvePathSafe,
  isAudioFile,
  isImageFile,
  isVideoFile,
  isPdfFile,
  formatID,
  extractRJFromName,
  guessMimeType,
  AUDIO_EXTS,
  IMAGE_EXTS,
  getWindowsReservedFilenameCharacters,
  inspectListedButInaccessiblePath,
  toWindowsSafeFilename,
} from '../../filesystem/utils';

describe('File System Utilities', () => {
  const testDataDir = path.join(__dirname, '../test-data');

  beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  describe('resolvePathSafe', () => {
    it('should resolve valid paths within base directory', () => {
      const basePath = 'test/base';
      const relativePath = 'subdir/file.txt';

      const resolved = resolvePathSafe(basePath, relativePath);

      expect(resolved).toContain('test');
      expect(resolved).toContain('base');
      expect(resolved).toContain('subdir');
    });

    it('should resolve from process.cwd()', () => {
      const resolved = resolvePathSafe('test', 'file.txt');

      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.startsWith(process.cwd())).toBe(true);
    });

    it('should handle multiple path segments', () => {
      const resolved = resolvePathSafe('a', 'b', 'c', 'file.txt');

      expect(resolved).toContain('a');
      expect(resolved).toContain('b');
      expect(resolved).toContain('c');
    });

    it('should normalize paths', () => {
      const resolved = resolvePathSafe('test', '..', 'other', 'file.txt');

      expect(path.isAbsolute(resolved)).toBe(true);
    });
  });

  describe('SMB path inspection', () => {
    it('detects a directory entry that is listed but cannot be opened', () => {
      const existsSync = (targetPath: string) => targetPath === '/library';
      const readdirSync = (targetPath: string) => targetPath === '/library' ? ['bad?', 'healthy'] : [];

      const issue = inspectListedButInaccessiblePath('/library/bad?/work', { existsSync, readdirSync });

      expect(issue).toEqual({
        path: '/library/bad?',
        name: 'bad?',
        reservedCharacters: ['?'],
        suggestedName: 'bad？',
        suggestedPath: '/library/bad？',
      });
    });

    it('replaces Windows-reserved filename characters with fullwidth equivalents', () => {
      expect(getWindowsReservedFilenameCharacters('a?b:c?')).toEqual(['?', ':']);
      expect(toWindowsSafeFilename('a<bad>:"name"/part\\file|?*'))
        .toBe('a＜bad＞：＂name＂／part＼file｜？＊');
    });

    it('returns null when the missing component is not present in its parent listing', () => {
      const issue = inspectListedButInaccessiblePath('/library/missing/work', {
        existsSync: targetPath => targetPath === '/library',
        readdirSync: () => ['another-directory'],
      });

      expect(issue).toBeNull();
    });

    it('does not misdiagnose a listed entry without reserved characters', () => {
      const issue = inspectListedButInaccessiblePath('/library/broken-link/work', {
        existsSync: targetPath => targetPath === '/library',
        readdirSync: () => ['broken-link'],
      });

      expect(issue).toBeNull();
    });

    it('returns null when the target path is accessible', () => {
      const issue = inspectListedButInaccessiblePath('/library/healthy', {
        existsSync: () => true,
        readdirSync: () => [],
      });

      expect(issue).toBeNull();
    });
  });

  describe('isAudioFile', () => {
    it('should identify MP3 files', () => {
      expect(isAudioFile('song.mp3')).toBe(true);
      expect(isAudioFile('SONG.MP3')).toBe(true);
    });

    it('should identify WAV files', () => {
      expect(isAudioFile('audio.wav')).toBe(true);
      expect(isAudioFile('AUDIO.WAV')).toBe(true);
    });

    it('should identify FLAC files', () => {
      expect(isAudioFile('track.flac')).toBe(true);
    });

    it('should identify M4A files', () => {
      expect(isAudioFile('audio.m4a')).toBe(true);
    });

    it('should identify OGG files', () => {
      expect(isAudioFile('sound.ogg')).toBe(true);
    });

    it('should identify OPUS files', () => {
      expect(isAudioFile('track.opus')).toBe(true);
    });

    it('should reject non-audio files', () => {
      expect(isAudioFile('document.txt')).toBe(false);
      expect(isAudioFile('image.jpg')).toBe(false);
      expect(isAudioFile('video.mp4')).toBe(false);
    });

    it('should reject files without extensions', () => {
      expect(isAudioFile('README')).toBe(false);
    });

    it('should handle paths with multiple dots', () => {
      expect(isAudioFile('my.song.v2.mp3')).toBe(true);
      expect(isAudioFile('my.file.txt')).toBe(false);
    });
  });

  describe('isImageFile', () => {
    it('should identify JPG/JPEG files', () => {
      expect(isImageFile('photo.jpg')).toBe(true);
      expect(isImageFile('photo.jpeg')).toBe(true);
      expect(isImageFile('PHOTO.JPG')).toBe(true);
    });

    it('should identify PNG files', () => {
      expect(isImageFile('image.png')).toBe(true);
      expect(isImageFile('IMAGE.PNG')).toBe(true);
    });

    it('should identify WebP files', () => {
      expect(isImageFile('modern.webp')).toBe(true);
    });

    it('should reject non-image files', () => {
      expect(isImageFile('document.txt')).toBe(false);
      expect(isImageFile('audio.mp3')).toBe(false);
      expect(isImageFile('video.mp4')).toBe(false);
    });
  });

  describe('isVideoFile', () => {
    it('should identify MP4 files', () => {
      expect(isVideoFile('video.mp4')).toBe(true);
      expect(isVideoFile('VIDEO.MP4')).toBe(true);
    });

    it('should identify WebM files', () => {
      expect(isVideoFile('clip.webm')).toBe(true);
    });

    it('should identify MKV files', () => {
      expect(isVideoFile('movie.mkv')).toBe(true);
    });

    it('should identify MOV files', () => {
      expect(isVideoFile('recording.mov')).toBe(true);
    });

    it('should reject non-video files', () => {
      expect(isVideoFile('audio.mp3')).toBe(false);
      expect(isVideoFile('image.jpg')).toBe(false);
    });
  });

  describe('isPdfFile', () => {
    it('should identify PDF files', () => {
      expect(isPdfFile('document.pdf')).toBe(true);
      expect(isPdfFile('DOCUMENT.PDF')).toBe(true);
    });

    it('should reject non-PDF files', () => {
      expect(isPdfFile('document.txt')).toBe(false);
      expect(isPdfFile('image.jpg')).toBe(false);
    });
  });

  describe('formatID', () => {
    it('should pad 6-digit IDs', () => {
      expect(formatID('123456')).toBe('123456');
      expect(formatID('12345')).toBe('012345');
      expect(formatID('1')).toBe('000001');
    });

    it('should pad 7-digit IDs to 8 digits', () => {
      expect(formatID('1332445')).toBe('01332445');
    });

    it('should keep 8-digit IDs', () => {
      expect(formatID('12345678')).toBe('12345678');
    });

    it('should strip non-numeric characters', () => {
      expect(formatID('RJ123456')).toBe('123456');
      expect(formatID('RJ01234567')).toBe('01234567');
    });

    it('should handle longer IDs by taking last 8', () => {
      expect(formatID('123456789')).toBe('23456789');
    });

    it('should return empty string for non-numeric input', () => {
      expect(formatID('abc')).toBe('');
      expect(formatID('')).toBe('');
    });
  });

  describe('extractRJFromName', () => {
    it('should extract 6-digit RJ numbers', () => {
      expect(extractRJFromName('RJ123456')).toBe('123456');
      expect(extractRJFromName('rj123456')).toBe('123456');
    });

    it('should extract 8-digit RJ numbers', () => {
      expect(extractRJFromName('RJ01234567')).toBe('01234567');
    });

    it('should extract from numeric-only names', () => {
      expect(extractRJFromName('123456')).toBe('123456');
      expect(extractRJFromName('01234567')).toBe('01234567');
    });

    it('should handle hidden files', () => {
      expect(extractRJFromName('.RJ123456')).toBe('123456');
      expect(extractRJFromName('..RJ01234567')).toBe('01234567');
    });

    it('should return null for invalid formats', () => {
      expect(extractRJFromName('RJ12345')).toBeNull(); // 5 digits
      expect(extractRJFromName('RJ1234567')).toBeNull(); // 7 digits
      expect(extractRJFromName('123')).toBeNull();
      expect(extractRJFromName('abcdef')).toBeNull();
      expect(extractRJFromName('RJ123456extra')).toBeNull();
    });
  });

  describe('guessMimeType', () => {
    it('should return correct MIME for audio files', () => {
      expect(guessMimeType('file.mp3')).toBe('audio/mpeg');
      expect(guessMimeType('file.m4a')).toBe('audio/mp4');
      expect(guessMimeType('file.flac')).toBe('audio/flac');
      expect(guessMimeType('file.wav')).toBe('audio/wav');
      expect(guessMimeType('file.ogg')).toBe('audio/ogg');
      expect(guessMimeType('file.opus')).toBe('audio/opus');
    });

    it('should return correct MIME for image files', () => {
      expect(guessMimeType('file.jpg')).toBe('image/jpeg');
      expect(guessMimeType('file.jpeg')).toBe('image/jpeg');
      expect(guessMimeType('file.png')).toBe('image/png');
      expect(guessMimeType('file.webp')).toBe('image/webp');
      expect(guessMimeType('file.svg')).toBe('image/svg+xml');
    });

    it('should return correct MIME for video files', () => {
      expect(guessMimeType('file.mp4')).toBe('video/mp4');
      expect(guessMimeType('file.webm')).toBe('video/webm');
      expect(guessMimeType('file.mkv')).toBe('video/x-matroska');
      expect(guessMimeType('file.mov')).toBe('video/quicktime');
    });

    it('should return correct MIME for PDF', () => {
      expect(guessMimeType('file.pdf')).toBe('application/pdf');
    });

    it('should return octet-stream for unknown types', () => {
      expect(guessMimeType('file.xyz')).toBe('application/octet-stream');
      expect(guessMimeType('unknown')).toBe('application/octet-stream');
    });

    it('should be case-insensitive', () => {
      expect(guessMimeType('FILE.MP3')).toBe('audio/mpeg');
      expect(guessMimeType('FILE.JPG')).toBe('image/jpeg');
    });
  });

  describe('Constants', () => {
    it('should export AUDIO_EXTS set', () => {
      expect(AUDIO_EXTS).toBeInstanceOf(Set);
      expect(AUDIO_EXTS.has('.mp3')).toBe(true);
      expect(AUDIO_EXTS.has('.wav')).toBe(true);
      expect(AUDIO_EXTS.has('.flac')).toBe(true);
    });

    it('should export IMAGE_EXTS set', () => {
      expect(IMAGE_EXTS).toBeInstanceOf(Set);
      expect(IMAGE_EXTS.has('.jpg')).toBe(true);
      expect(IMAGE_EXTS.has('.png')).toBe(true);
      expect(IMAGE_EXTS.has('.webp')).toBe(true);
    });
  });

  describe('File Type Edge Cases', () => {
    it('should handle files with no extension', () => {
      expect(isAudioFile('Makefile')).toBe(false);
      expect(isImageFile('Dockerfile')).toBe(false);
      expect(isPdfFile('README')).toBe(false);
    });

    it('should handle hidden files', () => {
      expect(isAudioFile('.hidden.mp3')).toBe(true);
      expect(isImageFile('.config.jpg')).toBe(true);
    });

    it('should handle files with spaces', () => {
      expect(isAudioFile('my song.mp3')).toBe(true);
      expect(isImageFile('vacation photo.jpg')).toBe(true);
    });

    it('should handle unicode filenames', () => {
      expect(isAudioFile('音楽.mp3')).toBe(true);
      expect(isImageFile('画像.jpg')).toBe(true);
      expect(isPdfFile('文書.pdf')).toBe(true);
    });
  });
});
