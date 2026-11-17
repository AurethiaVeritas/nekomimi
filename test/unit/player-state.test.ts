import type { playerReducer as PlayerReducer, restorePlayerState as RestorePlayerState, restorePlayerVolume as RestorePlayerVolume, PlayerState } from '../../client/src/player/playerState.js' with { 'resolution-mode': 'import' };

let playerReducer: typeof PlayerReducer;
let restorePlayerState: typeof RestorePlayerState;
let restorePlayerVolume: typeof RestorePlayerVolume;
beforeAll(async () => { ({ playerReducer, restorePlayerState, restorePlayerVolume } = await import('../../client/src/player/playerState.js')); });

const tracks = ['A', 'B', 'C'].map(title => ({ title, url: `/${title}.wav` }));
const stateFor = (current = 1, playing = true): PlayerState => ({ queue: tracks, current, playing });

describe('Player queue transitions', () => {
  it('keeps the playing track selected when removing an earlier entry or reordering around it', () => {
    const original = stateFor();
    const removed = playerReducer(original, { type: 'remove', index: 0 });
    expect(removed.queue[removed.current]).toBe(tracks[1]);
    const moved = playerReducer(original, { type: 'move', from: 0, to: 2 });
    expect(moved.queue[moved.current]).toBe(tracks[1]);
    expect(original.queue).toEqual(tracks);
    expect(original.current).toBe(1);
  });

  it('updates selection atomically when the selected track moves or is removed', () => {
    const moved = playerReducer(stateFor(), { type: 'move', from: 1, to: 2 });
    expect(moved.current).toBe(2);
    expect(moved.queue[moved.current]).toBe(tracks[1]);
    const removed = playerReducer(moved, { type: 'remove', index: 2 });
    expect(removed.current).toBe(1);
    expect(removed.queue[removed.current]).toBe(tracks[2]);
  });

  it('validates batched moves against the latest queue after removal', () => {
    const removed = playerReducer(stateFor(), { type: 'remove', index: 2 });
    const moved = playerReducer(removed, { type: 'move', from: 2, to: 0 });
    expect(moved).toBe(removed);
    expect(moved.queue).not.toContain(undefined);
  });

  it('clamps replacement playlist selection even when its length is unchanged', () => {
    const replaced = playerReducer(stateFor(), { type: 'playList', items: tracks, startIndex: 99 });
    expect(replaced.current).toBe(2);
    expect(replaced.queue[replaced.current]).toBe(tracks[2]);
    expect(replaced.playing).toBe(true);
  });

  it('stops when the playlist becomes empty or advances past its final track', () => {
    const empty = playerReducer(stateFor(), { type: 'playList', items: [], startIndex: 0 });
    expect(empty).toEqual({ queue: [], current: 0, playing: false });
    expect(playerReducer(empty, { type: 'playing', value: true }).playing).toBe(false);
    expect(playerReducer(stateFor(2), { type: 'next', continuePlaying: true })).toMatchObject({ current: 2, playing: false });
    expect(playerReducer({ queue: [tracks[0]], current: 0, playing: true }, { type: 'remove', index: 0 }))
      .toEqual({ queue: [], current: 0, playing: false });
  });

  it('auto-advances while playing and preserves a manual pause', () => {
    expect(playerReducer(stateFor(0, false), { type: 'next', continuePlaying: false })).toMatchObject({ current: 1, playing: false });
    expect(playerReducer(stateFor(0, false), { type: 'next', continuePlaying: true })).toMatchObject({ current: 1, playing: true });
    expect(playerReducer(stateFor(), { type: 'playing', value: previous => !previous }).playing).toBe(false);
  });

  it.each([-1, 3, 0.5, NaN])('ignores an invalid queue selection (%s)', index => {
    const state = stateFor();
    expect(playerReducer(state, { type: 'select', index })).toBe(state);
  });
});

describe('Stored player state', () => {
  const storage = (values: Record<string, string>) => () => ({ getItem: (key: string) => values[key] ?? null });

  it('discards invalid persisted tracks and repairs a fractional selection', () => {
    const restored = restorePlayerState(storage({
      'player.queue': JSON.stringify([null, tracks[0], { url: '' }, tracks[1]]),
      'player.current': '0.5',
    }));
    expect(restored).toEqual({ queue: [tracks[0], tracks[1]], current: 0, playing: false });
  });

  it('clamps a persisted index and restores paused playback', () => {
    expect(restorePlayerState(storage({ 'player.queue': JSON.stringify(tracks), 'player.current': '20' })))
      .toMatchObject({ current: 2, playing: false });
    expect(restorePlayerState(storage({ 'player.queue': 'broken JSON' }))).toEqual({ queue: [], current: 0, playing: false });
  });

  it('loads safely when browser storage is blocked', () => {
    const blocked = () => { throw new Error('Storage denied'); };
    expect(restorePlayerState(blocked)).toEqual({ queue: [], current: 0, playing: false });
    expect(restorePlayerVolume(blocked)).toBe(0.8);
  });

  it('requires renewed consent for amplified volume on each page load', () => {
    expect(restorePlayerVolume(storage({ 'player.volume': '1.8' }))).toBe(1);
    expect(restorePlayerVolume(storage({ 'player.volume': '0.4' }))).toBe(0.4);
    expect(restorePlayerVolume(storage({ 'player.volume': 'broken' }))).toBe(0.8);
  });
});
