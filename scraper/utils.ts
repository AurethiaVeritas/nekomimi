import { createHash } from 'node:crypto';

const namespace = '699d9c07-b965-4399-bafd-18a3cacf073c';

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/-/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToUuid = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const namespaceBytes = hexToBytes(namespace);

export const nameToUUID = (name: string): string => {
  const hash = createHash('sha1');
  hash.update(namespaceBytes);
  hash.update(Buffer.from(name, 'utf8'));
  const digest = hash.digest();
  digest[6] = (digest[6] & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80; // variant RFC4122
  return bytesToUuid(digest.subarray(0, 16));
};

/**
 * Returns whether a string contains an ASCII letter.
 */
export const hasLetter = (str: string): boolean => {
  for (const ch of str) {
    const asc = ch.charCodeAt(0);
    if ((asc >= 65 && asc <= 90) || (asc >= 97 && asc <= 122)) {
      return true;
    }
  }
  return false;
};
