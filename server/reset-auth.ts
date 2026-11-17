#!/usr/bin/env node
/*
 * Reset authentication: removes data/users.json and data/secret.key
 * Usage:
 *   node server/reset-auth.js --yes
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const USERS = path.join(DATA_DIR, 'users.json');
const SECRET = path.join(DATA_DIR, 'secret.key');

function exists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

async function main() {
  const force = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!force) {
    console.log('This will DELETE auth state (users.json and secret.key).');
    console.log('Re-run with --yes to proceed.');
    process.exit(1);
  }
  const removed: string[] = [];
  if (exists(USERS)) { fs.rmSync(USERS, { force: true }); removed.push(USERS); }
  if (exists(SECRET)) { fs.rmSync(SECRET, { force: true }); removed.push(SECRET); }
  if (removed.length === 0) {
    console.log('Nothing to remove. No auth files found under', DATA_DIR);
  } else {
    console.log('Removed:');
    removed.forEach(p => {
      console.log(' -', p);
    });
    console.log('Done. Restart the server, then open /login and use the account setup token printed in the server terminal to initialize a new admin.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
