import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';

import { playerReducer, restorePlayerState, restorePlayerVolume, type PlayerTrack } from './playerState';
export type { PlayerTrack } from './playerState';

type PlayerContextValue = {
  queue: PlayerTrack[];
  current: number;
  playing: boolean;
  volume: number;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  clear: () => void;
  addToQueue: (items: PlayerTrack[]) => void;
  playList: (items: PlayerTrack[], startIndex?: number) => void;
  playNext: (shouldContinuePlaying?: boolean) => void;
  playPrev: () => void;
  setIndex: (index: number) => void;
  setPlaying: (value: boolean | ((prev: boolean) => boolean)) => void;
  removeAt: (idx: number) => void;
  moveItem: (from: number, to: number) => void;
};

const PlayerCtx = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, undefined, () => restorePlayerState());
  const { queue, current } = state;
  const [volume, setVolume] = useState(() => restorePlayerVolume());

  useEffect(() => {
    try { localStorage.setItem('player.volume', String(volume)); } catch { }
  }, [volume]);
  useEffect(() => {
    try {
      localStorage.setItem('player.queue', JSON.stringify(queue));
      localStorage.setItem('player.current', String(current));
    } catch { }
  }, [queue, current]);

  const actions = useMemo(() => ({
    clear: () => dispatch({ type: 'clear' }),
    addToQueue: (items: PlayerTrack[]) => dispatch({ type: 'add', items }),
    playList: (items: PlayerTrack[], startIndex = 0) => dispatch({ type: 'playList', items, startIndex }),
    playNext: (shouldContinuePlaying = false) => dispatch({ type: 'next', continuePlaying: shouldContinuePlaying }),
    playPrev: () => dispatch({ type: 'previous' }),
    setIndex: (index: number) => dispatch({ type: 'select', index }),
    setPlaying: (value: boolean | ((prev: boolean) => boolean)) => dispatch({ type: 'playing', value }),
    removeAt: (index: number) => dispatch({ type: 'remove', index }),
    moveItem: (from: number, to: number) => dispatch({ type: 'move', from, to }),
  }), [dispatch]);

  const value = useMemo<PlayerContextValue>(() => ({
    ...state, volume, setVolume, ...actions,
  }), [state, volume, actions]);

  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
