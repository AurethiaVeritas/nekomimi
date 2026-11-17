import fs from 'node:fs';
import path from 'node:path';
import { resolvePathSafe } from '../filesystem/utils';
import { config } from '../config';
import type { Settings } from './types';
import { ensureDirectory, readJsonFile, writeJsonFile } from './storage';

const dataDir = resolvePathSafe(config.dataDir);
const settingsFile = path.join(dataDir, 'settings.json');

function loadSettings(): Settings {
  ensureDirectory(dataDir);
  if (!fs.existsSync(settingsFile)) return {};
  return readJsonFile<Settings>(settingsFile, {});
}

function saveSettings(obj: Settings): void {
  ensureDirectory(dataDir);
  writeJsonFile(settingsFile, obj);
}

export async function getSettings(): Promise<Settings> {
  return loadSettings();
}

export async function updateSettings(patch: Settings): Promise<Settings> {
  const current = loadSettings();
  const next = { ...current, ...patch };
  saveSettings(next);
  return next;
}
