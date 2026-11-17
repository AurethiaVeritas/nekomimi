import fs from 'node:fs';
import path from 'node:path';
import { isPathWithinAllowed } from '../../server/pathGuard';

describe('Allowed path boundaries', () => {
  it('allows descendants of a filesystem root without crossing a symlink', () => {
    const target = fs.realpathSync(process.env.DATA_DIR!);
    expect(isPathWithinAllowed(target, [path.parse(target).root])).toBe(true);
  });

  it('keeps sibling prefixes and parent traversal outside the allowed root', () => {
    const root = path.join(process.env.DATA_DIR!, 'library');
    expect(isPathWithinAllowed(root, [root])).toBe(true);
    expect(isPathWithinAllowed(path.join(root, '..hidden', 'track.mp3'), [root])).toBe(true);
    expect(isPathWithinAllowed(`${root}-other/track.mp3`, [root])).toBe(false);
    expect(isPathWithinAllowed(path.join(root, '..', 'track.mp3'), [root])).toBe(false);
  });

  it('accepts a configured symlink root while rejecting symlinks beneath it', () => {
    const target = path.join(process.env.DATA_DIR!, 'canonical');
    const root = path.join(process.env.DATA_DIR!, 'mounted-root');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'track.mp3'), 'sample');
    fs.symlinkSync(target, root, 'dir');
    fs.symlinkSync(path.join(target, 'track.mp3'), path.join(target, 'linked.mp3'));
    expect(isPathWithinAllowed(path.join(root, 'track.mp3'), [root])).toBe(true);
    expect(isPathWithinAllowed(path.join(root, 'linked.mp3'), [root])).toBe(false);
    expect(isPathWithinAllowed(path.join(target, 'missing', 'track.mp3'), [root])).toBe(false);
  });
});
