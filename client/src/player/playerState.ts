export type PlayerTrack = {
  url: string;
  title?: string;
  meta?: Record<string, unknown>;
  restorePosition?: boolean;
};

export type PlayerState = { queue: PlayerTrack[]; current: number; playing: boolean };
export type PlayerAction =
  | { type: 'clear' }
  | { type: 'add'; items: PlayerTrack[] }
  | { type: 'playList'; items: PlayerTrack[]; startIndex: number }
  | { type: 'next'; continuePlaying: boolean }
  | { type: 'previous' }
  | { type: 'select'; index: number }
  | { type: 'playing'; value: boolean | ((previous: boolean) => boolean) }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number };

const emptyState = (): PlayerState => ({ queue: [], current: 0, playing: false });
const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
const clampIndex = (index: number, length: number) => (
  length === 0 ? 0 : Math.min(Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0), length - 1)
);

// Queue order, selection, and playback change together. Updaters remain pure
// when React replays them or batches several queue actions in one render.
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'clear': return emptyState();
    case 'add': return action.items.length ? { ...state, queue: [...state.queue, ...action.items] } : state;
    case 'playList': return {
      queue: [...action.items],
      current: clampIndex(action.startIndex, action.items.length),
      playing: action.items.length > 0,
    };
    case 'next': return state.current >= state.queue.length - 1
      ? { ...state, playing: false }
      : { ...state, current: state.current + 1, playing: action.continuePlaying || state.playing };
    case 'previous': return { ...state, current: Math.max(0, state.current - 1) };
    case 'select': return validIndex(action.index, state.queue.length)
      ? { ...state, current: action.index, playing: true } : state;
    case 'playing': return {
      ...state,
      playing: state.queue.length > 0 && (typeof action.value === 'function' ? action.value(state.playing) : action.value),
    };
    case 'remove': {
      if (!validIndex(action.index, state.queue.length)) return state;
      const queue = state.queue.filter((_, index) => index !== action.index);
      return {
        queue,
        current: clampIndex(action.index < state.current ? state.current - 1 : state.current, queue.length),
        playing: queue.length > 0 && state.playing,
      };
    }
    case 'move': {
      const { from, to } = action;
      if (from === to || !validIndex(from, state.queue.length) || !validIndex(to, state.queue.length)) return state;
      const queue = [...state.queue];
      const [item] = queue.splice(from, 1);
      queue.splice(to, 0, item);
      const current = state.current === from ? to
        : from < state.current && to >= state.current ? state.current - 1
        : from > state.current && to <= state.current ? state.current + 1 : state.current;
      return { ...state, queue, current };
    }
  }
}

type StoredValues = { getItem(key: string): string | null };
type GetStorage = () => StoredValues;
const defaultStorage: GetStorage = () => localStorage;

export function restorePlayerState(getStorage: GetStorage = defaultStorage): PlayerState {
  try {
    const storage = getStorage();
    const parsed: unknown = JSON.parse(storage.getItem('player.queue') || '[]');
    const queue = Array.isArray(parsed) ? parsed.filter((value): value is PlayerTrack => (
      value !== null && typeof value === 'object' && typeof value.url === 'string' && value.url.trim() !== ''
    )) : [];
    const current = Number(storage.getItem('player.current'));
    return { queue, current: clampIndex(Number.isInteger(current) ? current : 0, queue.length), playing: false };
  } catch { return emptyState(); }
}

export function restorePlayerVolume(getStorage: GetStorage = defaultStorage): number {
  try {
    const raw = getStorage().getItem('player.volume');
    const volume = raw === null ? NaN : Number(raw);
    // Amplification requires a fresh warning after every page load.
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8;
  } catch { return 0.8; }
}
