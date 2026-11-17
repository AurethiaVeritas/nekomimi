import {
  detectImageExtension,
  isAllowedRemoteCoverUrl,
  parseSingleByteRange,
} from '../../server/httpSecurity';

describe('HTTP security helpers', () => {
  it('parses open, closed, and suffix ranges without accepting multiple ranges', () => {
    expect(parseSingleByteRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
    expect(parseSingleByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseSingleByteRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 });
    expect(parseSingleByteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseSingleByteRange('bytes=10-', 10)).toBeNull();
  });

  it('allows only HTTPS cover URLs on provider-owned domains', () => {
    expect(isAllowedRemoteCoverUrl('https://img.dlsite.jp/example.jpg')).toBe(true);
    expect(isAllowedRemoteCoverUrl('https://api.asmr-200.com/api/cover/1.jpg')).toBe(true);
    expect(isAllowedRemoteCoverUrl('http://img.dlsite.jp/example.jpg')).toBe(false);
    expect(isAllowedRemoteCoverUrl('https://dlsite.jp.evil.example/example.jpg')).toBe(false);
    expect(isAllowedRemoteCoverUrl('https://127.0.0.1/example.jpg')).toBe(false);
  });

  it('recognizes only supported raster cover signatures', () => {
    expect(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('.jpg');
    expect(detectImageExtension(Buffer.from('RIFFxxxxWEBP', 'ascii'))).toBe('.webp');
    expect(detectImageExtension(Buffer.from('<svg></svg>'))).toBeNull();
  });
});
