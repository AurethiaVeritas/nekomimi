import fs from 'node:fs';
import { ALL_AGE_RATINGS, buildAgeRatingFilter, buildWorksFilter, worksSortClause, normalizeValue, type WorksFilterOptions } from './workFilters';
import path from 'node:path';
import initSqlJs, { type BindParams, type ParamsObject, type SqlValue, type SqlJsStatic, type Statement, type Database as SqlDatabase } from 'sql.js';
import { config } from '../config';
import { resolvePathSafe } from '../filesystem/utils';
import type { AgeRating, Tag, VA, RankEntry, RateCountDetail } from '../types/shared';
import { ensureDirectory } from './storage';

const dataDir = resolvePathSafe(config.dataDir);
const dbFile = config.dbPath ? resolvePathSafe(config.dbPath) : path.join(dataDir, 'nekomimi.db');

function ensureDataDir() {
  ensureDirectory(dataDir);
}

let SQL: SqlJsStatic | null = null;
let db: SqlDatabase | null = null;
let databaseShuttingDown = false;

const getDb = (): SqlDatabase => {
  if (!db) throw new Error('Database not initialized');
  return db;
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 200;
const SQLITE_BIND_CHUNK_SIZE = 900;

function configureConnection(database: SqlDatabase): void {
  database.exec('PRAGMA foreign_keys = ON');
  // Match JavaScript collection membership checks for Unicode text while
  // keeping the original spelling available for display.
  database.create_function('NORMALIZE_TEXT', normalizeValue);
}

async function init() {
  ensureDataDir();
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
  }
  if (!db && SQL) {
    if (fs.existsSync(dbFile)) {
      const fileBuffer = fs.readFileSync(dbFile);
      db = new SQL.Database(new Uint8Array(fileBuffer));
    } else {
      db = new SQL.Database();
    }
    configureConnection(db);
    // Schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS works (
        id INTEGER PRIMARY KEY,
        rjcode TEXT NOT NULL,
        title TEXT,
        circle_name TEXT,
        nsfw INTEGER DEFAULT 0,
        age_rating TEXT NOT NULL DEFAULT 'sfw' CHECK (age_rating IN ('sfw', 'r15', 'r18')),
        release TEXT,
        series_name TEXT,
        tags_json TEXT,
        vas_json TEXT,
        dl_count INTEGER DEFAULT 0,
        rate_average REAL DEFAULT 0,
        rate_count INTEGER DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        rank_json TEXT,
        rate_count_detail_json TEXT,
        base_dir TEXT,
        cover_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        filename TEXT,
        filepath TEXT,
        mime TEXT
      );

      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('manual', 'smart')),
        match_logic TEXT NOT NULL DEFAULT 'and' CHECK (match_logic IN ('and', 'or')),
        content_filter TEXT NOT NULL DEFAULT 'all' CHECK (content_filter IN ('sfw', 'r15', 'r18', 'all')),
        age_ratings_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS collections_owner_name_unique
      ON collections(owner_user_id, name COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS collection_works (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        added_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection_id, work_id)
      );

      CREATE INDEX IF NOT EXISTS collection_works_work_idx ON collection_works(work_id);
      
    `);
    const workColumns = db.exec('PRAGMA table_info(works)')[0]?.values || [];
    if (!workColumns.some(column => column[1] === 'age_rating')) {
      db.exec(`ALTER TABLE works ADD COLUMN age_rating TEXT NOT NULL DEFAULT 'sfw' CHECK (age_rating IN ('sfw', 'r15', 'r18'));
        UPDATE works SET age_rating = CASE WHEN nsfw = 1 THEN 'r18' ELSE 'sfw' END;`);
    }
    const collectionSchema = String(db.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'collections'")[0]?.values[0]?.[0] || '');
    if (!collectionSchema.includes("'r15'")) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec(`BEGIN TRANSACTION;
          CREATE TABLE collections_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('manual', 'smart')),
            match_logic TEXT NOT NULL DEFAULT 'and' CHECK (match_logic IN ('and', 'or')),
            content_filter TEXT NOT NULL DEFAULT 'all' CHECK (content_filter IN ('sfw', 'r15', 'r18', 'all')),
            age_ratings_json TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          );
          INSERT INTO collections_new SELECT id, owner_user_id, name, type, match_logic,
            CASE WHEN content_filter = 'nsfw' THEN 'r18' ELSE content_filter END,
            NULL, tags_json, created_at, updated_at FROM collections;
          DROP TABLE collections;
          ALTER TABLE collections_new RENAME TO collections;
          CREATE UNIQUE INDEX collections_owner_name_unique ON collections(owner_user_id, name COLLATE NOCASE);
          COMMIT;`);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
    const collectionColumns = db.exec('PRAGMA table_info(collections)')[0]?.values || [];
    if (!collectionColumns.some(column => column[1] === 'age_ratings_json')) {
      db.exec('ALTER TABLE collections ADD COLUMN age_ratings_json TEXT');
    }
    await save();
  }
}

async function save() {
  if (!db) return;
  ensureDataDir();
  const data = db.export();
  // sql.js exports by reopening the connection, clearing functions and pragmas.
  configureConnection(db);
  // Write Uint8Array directly - no Buffer.from() wrapper to avoid double allocation
  await fs.promises.writeFile(dbFile, data);
}

// Debounce state for save batching to reduce GC pressure during bulk operations
let saveTimeout: NodeJS.Timeout | null = null;
let savePending = false;

// Debounced save - batches multiple saves within 1 second to reduce memory churn
async function debouncedSave() {
  savePending = true;
  if (saveTimeout) return; // Already scheduled
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (!savePending) return;
    savePending = false;
    await save();
  }, 1000);
}

// Force immediate save - use for critical operations or shutdown
async function saveNow() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  savePending = false;
  await save();
}

let ready: Promise<void> | null = null;

export function initializeDatabase(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}

export async function flushDatabase(): Promise<void> {
  await initializeDatabase();
  await saveNow();
}

export function beginDatabaseShutdown(): void {
  databaseShuttingDown = true;
}

export type DbMedia = { id?: number; filename: string; filepath: string; mime: string | null };
export type DbCollectionType = 'manual' | 'smart';
export type DbCollectionMatch = 'and' | 'or';
export type DbCollectionContentFilter = 'sfw' | 'r15' | 'r18' | 'all';
export type DbCollection = {
  id: number;
  name: string;
  type: DbCollectionType;
  match: DbCollectionMatch;
  contentFilter: DbCollectionContentFilter | 'custom';
  ageRatings: AgeRating[];
  tags: string[];
  workCount: number;
  containsWork?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};
export type DbWork = {
  id: number | string;
  rjcode: string;
  title: string | null;
  circle: { name: string | null };
  nsfw: boolean;
  ageRating: AgeRating;
  release: string | null;
  series?: { name: string | null };
  tags: Tag[];
  vas: VA[];
  stats: {
    dl_count: number;
    rate_average_2dp: number;
    rate_count: number;
    review_count: number;
    rank: RankEntry[];
    rate_count_detail: RateCountDetail | null;
  };
  base_dir: string | null;
  cover_path: string | null;
  media: DbMedia[];
};

type ToWorkRowOptions = { includeMedia?: boolean };

function toWorkRow(row: ParamsObject | null, { includeMedia = true }: ToWorkRowOptions = {}): DbWork | null {
  if (!row) return null;
  return {
    id: row.id as number,
    rjcode: (row.rjcode as string) || '',
    title: (row.title as string) || null,
    circle: { name: (row.circle_name as string) || null },
    nsfw: row.age_rating === 'r18',
    ageRating: row.age_rating as AgeRating,
    release: (row.release as string) || null,
    series: row.series_name ? { name: row.series_name as string } : undefined,
    tags: row.tags_json ? JSON.parse(row.tags_json as string) : [],
    vas: row.vas_json ? JSON.parse(row.vas_json as string) : [],
    stats: {
      dl_count: (row.dl_count as number) || 0,
      rate_average_2dp: (row.rate_average as number) || 0,
      rate_count: (row.rate_count as number) || 0,
      review_count: (row.review_count as number) || 0,
      rank: row.rank_json ? JSON.parse(row.rank_json as string) : [],
      rate_count_detail: row.rate_count_detail_json ? JSON.parse(row.rate_count_detail_json as string) : null,
    },
    base_dir: (row.base_dir as string) || null,
    cover_path: (row.cover_path as string) || null,
    media: includeMedia ? selectMediaForWork(row.id as number) : [],
  };
}

function withStatement<T>(sql: string, params: ParamsObject, execute: (statement: Statement) => T): T {
  const statement = getDb().prepare(sql);
  try {
    statement.bind(params as BindParams);
    return execute(statement);
  } finally { statement.free(); }
}

function selectAll<T = ParamsObject>(sql: string, params: ParamsObject = {}): T[] {
  return withStatement(sql, params, statement => {
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  });
}

function run(sql: string, params: ParamsObject = {}) {
  if (databaseShuttingDown) throw new Error('Database is shutting down');
  withStatement(sql, params, statement => { statement.run(); });
}

function selectOne<T = ParamsObject>(sql: string, params: ParamsObject = {}): T | null {
  return withStatement(sql, params, statement => statement.step() ? statement.getAsObject() as T : null);
}

function selectMediaForWork(workId: number | string): DbMedia[] {
  return selectAll<ParamsObject>(`SELECT id, filename, filepath, mime FROM media WHERE work_id = $id ORDER BY id`, { $id: workId })
    .map(m => ({ id: Number(m.id), filename: String(m.filename), filepath: String(m.filepath), mime: (m.mime as string) || null }));
}

type MediaInput = { filename: string; filepath: string; mime?: string | null };

function insertMediaRows(workId: number | string, files: MediaInput[]): void {
  for (const file of files) {
    run(`INSERT INTO media (work_id, filename, filepath, mime) VALUES ($work_id, $filename, $filepath, $mime)`, {
      $work_id: workId,
      $filename: file.filename,
      $filepath: file.filepath,
      $mime: file.mime || null,
    });
  }
}

type UpsertWorkInput = {
  id: number | string;
  rjcode: string;
  title?: string | null;
  circle?: { name?: string | null } | null;
  nsfw?: boolean;
  ageRating?: AgeRating;
  release?: string | null;
  series?: { name?: string | null } | null;
  tags?: unknown[];
  vas?: unknown[];
  stats?: {
    dl_count?: number;
    rate_average_2dp?: number;
    rate_count?: number;
    review_count?: number;
    rank?: unknown[];
    rate_count_detail?: unknown;
  } | null;
  base_dir?: string | null;
  cover_path?: string | null;
  media?: { filename: string; filepath: string; mime?: string | null }[];
};

type UpsertWorkOptions = {
  preserveUpdatedAt?: boolean;
};

async function upsertWork(work: UpsertWorkInput, options: UpsertWorkOptions = {}) {
  await initializeDatabase();
  const ageRating = work.ageRating ?? (work.nsfw ? 'r18' : 'sfw');
  const payload = {
    $id: work.id,
    $rjcode: work.rjcode,
    $title: work.title || '',
    $circle_name: work.circle?.name || '',
    $nsfw: ageRating === 'r18' ? 1 : 0,
    $age_rating: ageRating,
    $release: work.release || '',
    $series_name: work.series?.name || '',
    $tags_json: JSON.stringify(work.tags || []),
    $vas_json: JSON.stringify(work.vas || []),
    $dl_count: work.stats?.dl_count || 0,
    $rate_average: work.stats?.rate_average_2dp || 0,
    $rate_count: work.stats?.rate_count || 0,
    $review_count: work.stats?.review_count || 0,
    $rank_json: JSON.stringify(work.stats?.rank || []),
    $rate_count_detail_json: JSON.stringify(work.stats?.rate_count_detail || null),
    $base_dir: work.base_dir || null,
    $cover_path: work.cover_path || null,
    $preserve_updated_at: options.preserveUpdatedAt ? 1 : 0,
  };

  run('BEGIN TRANSACTION');
  try {
    run(`
      INSERT INTO works (id, rjcode, title, circle_name, nsfw, age_rating, release, series_name, tags_json, vas_json,
                         dl_count, rate_average, rate_count, review_count, rank_json, rate_count_detail_json,
                         base_dir, cover_path, created_at, updated_at)
      VALUES ($id, $rjcode, $title, $circle_name, $nsfw, $age_rating, $release, $series_name, $tags_json, $vas_json,
              $dl_count, $rate_average, $rate_count, $review_count, $rank_json, $rate_count_detail_json,
              $base_dir, $cover_path, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        rjcode=$rjcode,
        title=$title,
        circle_name=$circle_name,
        nsfw=$nsfw,
        age_rating=$age_rating,
        release=$release,
        series_name=$series_name,
        tags_json=$tags_json,
        vas_json=$vas_json,
        dl_count=$dl_count,
        rate_average=$rate_average,
        rate_count=$rate_count,
        review_count=$review_count,
        rank_json=$rank_json,
        rate_count_detail_json=$rate_count_detail_json,
        base_dir=$base_dir,
        cover_path=$cover_path,
        updated_at=CASE WHEN $preserve_updated_at THEN updated_at ELSE datetime('now') END;
    `, payload);

    // Keep the work row and its media replacement atomic.
    if (Array.isArray(work.media)) {
      run(`DELETE FROM media WHERE work_id = $id`, { $id: work.id });
      insertMediaRows(work.id, work.media);
    }
    run('COMMIT');
  } catch (error) {
    try { run('ROLLBACK'); } catch { }
    throw error;
  }

  debouncedSave();
  return getWork(work.id);
}

async function getWork(id: number | string): Promise<DbWork | null> {
  await initializeDatabase();
  const row = selectOne(`SELECT * FROM works WHERE id = $id`, { $id: id });
  return toWorkRow(row);
}

async function listWorks(): Promise<DbWork[]> {
  await initializeDatabase();
  const rows = selectAll(`SELECT * FROM works ORDER BY updated_at DESC`);
  return rows.map(row => toWorkRow(row)).filter(Boolean) as DbWork[];
}

async function getExistingWorkIds(ids: Array<number | string>): Promise<Set<number>> {
  await initializeDatabase();
  const values = Array.from(new Set(ids
    .map(v => Number(v))
    .filter(v => Number.isFinite(v))));
  const existing = new Set<number>();
  for (let offset = 0; offset < values.length; offset += SQLITE_BIND_CHUNK_SIZE) {
    const chunk = values.slice(offset, offset + SQLITE_BIND_CHUNK_SIZE);
    const placeholders = chunk.map((_, index) => `$id${index}`);
    const params: ParamsObject = {};
    chunk.forEach((value, index) => { params[placeholders[index]] = value as SqlValue; });
    const rows = selectAll<ParamsObject>(
      `SELECT id FROM works WHERE id IN (${placeholders.join(', ')})`,
      params,
    );
    for (const row of rows) {
      const id = Number(row.id);
      if (Number.isFinite(id)) existing.add(id);
    }
  }
  return existing;
}

async function attachMedia(workId: number | string, files: MediaInput[]): Promise<DbWork | null> {
  await initializeDatabase();
  insertMediaRows(workId, files);
  debouncedSave();
  return getWork(workId);
}

async function deleteWork(id: number | string) {
  await initializeDatabase();
  // Ensure related media rows are removed
  run(`DELETE FROM media WHERE work_id = $id`, { $id: id });
  run(`DELETE FROM works WHERE id = $id`, { $id: id });
  await saveNow();
}

type CountResult = { total: SqlValue };
type PaginationOptions = { page?: number; pageSize?: number; sort?: string };
type WorkQuery = { fromClause: string; whereClause: string; params: ParamsObject };
type SearchWorksOptions = WorksFilterOptions & PaginationOptions;

function resolvePagination(options: PaginationOptions) {
  const page = Number.isFinite(options.page) && Number(options.page) >= 1 ? Number(options.page) : 1;
  const requestedSize = Number.isFinite(options.pageSize) && Number(options.pageSize) >= 1
    ? Number(options.pageSize)
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function queryWorksPage(query: WorkQuery, options: PaginationOptions) {
  const { page, pageSize, offset } = resolvePagination(options);
  const countRow = selectOne<CountResult>(
    `SELECT COUNT(*) AS total ${query.fromClause} ${query.whereClause}`,
    query.params,
  );
  const total = Number(countRow?.total || 0);
  const rows = selectAll(`
    SELECT works.*
    ${query.fromClause}
    ${query.whereClause}
    ${worksSortClause(options.sort)}
    LIMIT $limit OFFSET $offset
  `, { ...query.params, $limit: pageSize, $offset: offset });
  const items = rows.map(row => toWorkRow(row, { includeMedia: false })).filter(Boolean) as DbWork[];
  return { items, total, page, pageSize };
}

async function searchWorks(options: SearchWorksOptions = {}) {
  await initializeDatabase();
  return queryWorksPage(buildWorksFilter(options), options);
}

function computeFacets(fromClause: string, whereClause: string, params: ParamsObject) {
  const filteredCte = `WITH filtered AS (
    SELECT works.*
    ${fromClause}
    ${whereClause}
  )`;

  const circleRows = selectAll(`
    ${filteredCte}
    SELECT TRIM(circle_name) AS name, COUNT(*) AS count
    FROM filtered
    WHERE TRIM(COALESCE(circle_name, '')) != ''
    GROUP BY TRIM(circle_name)
    ORDER BY count DESC, name ASC
  `, params);

  const selectJsonFacet = (column: 'tags_json' | 'vas_json') => selectAll(`
      ${filteredCte}
      SELECT
        NORMALIZE_TEXT(json_extract(value, '$.name')) AS normalized,
        MIN(TRIM(json_extract(value, '$.name'))) AS name,
        COUNT(DISTINCT filtered.id) AS count
      FROM filtered, json_each(filtered.${column})
      WHERE TRIM(COALESCE(json_extract(value, '$.name'), '')) != ''
      GROUP BY normalized
      ORDER BY count DESC, name ASC
    `, params);

  const tagRows = selectJsonFacet('tags_json');
  const vaRows = selectJsonFacet('vas_json');

  return {
    circles: circleRows.map(row => ({ name: row.name, count: Number(row.count) || 0 })),
    tags: tagRows.map(row => ({ name: row.name, count: Number(row.count) || 0 })),
    vas: vaRows.map(row => ({ name: row.name, count: Number(row.count) || 0 })),
  };
}

async function searchWorkFacets(options: WorksFilterOptions = {}) {
  await initializeDatabase();
  const built = buildWorksFilter(options);
  return computeFacets(built.fromClause, built.whereClause, built.params);
}

type ListCircleOptions = { nsfw?: string; ageRatings?: AgeRating[]; sort?: string };

async function listCircleSummaries(options: ListCircleOptions = {}) {
  await initializeDatabase();
  const clauses = [`TRIM(COALESCE(circle_name, '')) != ''`];
  const params: ParamsObject = {};
  const ratingFilter = buildAgeRatingFilter(options);
  if (ratingFilter.clause) clauses.push(ratingFilter.clause);
  Object.assign(params, ratingFilter.params);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = selectAll(`
    SELECT name, work_count, newest_id, newest_cover, newest_title, newest_release FROM (
      SELECT
        circle_name AS name,
        COUNT(*) OVER (PARTITION BY circle_name) AS work_count,
        ROW_NUMBER() OVER (
          PARTITION BY circle_name
          ORDER BY
            CASE WHEN release IS NULL OR release = '' THEN 1 ELSE 0 END,
            release DESC,
            datetime(updated_at) DESC,
            id DESC
        ) AS rank,
        id AS newest_id,
        cover_path AS newest_cover,
        title AS newest_title,
        release AS newest_release
      FROM works
      ${where}
    ) ranked
    WHERE rank = 1
  `, params);
  const sort = options.sort || 'name_asc';
  const items = rows.map(row => ({
    name: String(row.name || ''),
    count: Number(row.work_count) || 0,
    newestWorkId: row.newest_id as SqlValue,
    newestCoverPath: row.newest_cover as SqlValue,
    newestTitle: row.newest_title as SqlValue,
    newestRelease: row.newest_release as SqlValue,
  }));

  const compareNameAsc = (a: { name: string; count: number }, b: { name: string; count: number }) => a.name.localeCompare(b.name);
  const compareNameDesc = (a: { name: string; count: number }, b: { name: string; count: number }) => b.name.localeCompare(a.name);
  const compareCountDesc = (a: { name: string; count: number }, b: { name: string; count: number }) => (b.count - a.count) || a.name.localeCompare(b.name);
  const compareCountAsc = (a: { name: string; count: number }, b: { name: string; count: number }) => (a.count - b.count) || a.name.localeCompare(b.name);

  if (sort === 'name_desc') items.sort(compareNameDesc);
  else if (sort === 'count_desc') items.sort(compareCountDesc);
  else if (sort === 'count_asc') items.sort(compareCountAsc);
  else items.sort(compareNameAsc);

  return items;
}

const normalizeCollectionTag = (value: unknown) => String(value || '').trim();

function normalizeCollectionTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of values) {
    const name = normalizeCollectionTag(
      typeof entry === 'object' && entry !== null && 'name' in entry
        ? (entry as { name?: unknown }).name
        : entry
    );
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function parseCollectionTags(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    return normalizeCollectionTags(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeCollectionContentFilter(value: unknown): DbCollectionContentFilter {
  return value === 'sfw' || value === 'r15' || value === 'r18' ? value : value === 'nsfw' ? 'r18' : 'all';
}

function collectionAgeRatings(row: ParamsObject): AgeRating[] {
  if (typeof row.age_ratings_json === 'string') {
    try {
      const values: unknown = JSON.parse(row.age_ratings_json);
      if (Array.isArray(values)) return ALL_AGE_RATINGS.filter(rating => values.includes(rating));
    } catch { /* Fall back to the older content_filter field. */ }
  }
  const legacy = normalizeCollectionContentFilter(row.content_filter);
  return legacy === 'all' ? [...ALL_AGE_RATINGS] : [legacy];
}

function legacyContentFilter(ratings: AgeRating[]): DbCollectionContentFilter | 'custom' {
  return ratings.length === 3 ? 'all' : ratings.length === 1 ? ratings[0] : 'custom';
}

function getCollectionRow(ownerUserId: number, id: number | string): ParamsObject | null {
  return selectOne(`
    SELECT * FROM collections
    WHERE id = $id AND owner_user_id = $owner_user_id
  `, { $id: id, $owner_user_id: ownerUserId });
}

function buildSmartCollectionWhere(tags: string[], match: DbCollectionMatch, prefix = 'collectionTag') {
  const normalized = normalizeCollectionTags(tags).map(tag => tag.toLowerCase());
  if (!normalized.length) return { clause: '0 = 1', params: {} as ParamsObject };

  const params: ParamsObject = {};
  const placeholders = normalized.map((tag, index) => {
    const key = `$${prefix}${index}`;
    params[key] = tag;
    return key;
  });
  const normalizedTagName = `NORMALIZE_TEXT(json_extract(value, '$.name'))`;

  if (match === 'or') {
    return {
      clause: `EXISTS (
        SELECT 1 FROM json_each(COALESCE(works.tags_json, '[]'))
        WHERE ${normalizedTagName} IN (${placeholders.join(', ')})
      )`,
      params,
    };
  }

  const countKey = `$${prefix}Count`;
  params[countKey] = normalized.length;
  return {
    clause: `(
      SELECT COUNT(DISTINCT ${normalizedTagName})
      FROM json_each(COALESCE(works.tags_json, '[]'))
      WHERE ${normalizedTagName} IN (${placeholders.join(', ')})
    ) = ${countKey}`,
    params,
  };
}

function collectionWorkQuery(row: ParamsObject) {
  const collectionId = Number(row.id);
  const type: DbCollectionType = row.type === 'smart' ? 'smart' : 'manual';
  if (type === 'manual') {
    return {
      fromClause: 'FROM works INNER JOIN collection_works ON collection_works.work_id = works.id',
      whereClause: 'WHERE collection_works.collection_id = $collection_id',
      params: { $collection_id: collectionId } as ParamsObject,
    };
  }

  const match: DbCollectionMatch = row.match_logic === 'or' ? 'or' : 'and';
  const ageRatings = collectionAgeRatings(row);
  const smart = buildSmartCollectionWhere(parseCollectionTags(row.tags_json), match);
  const contentClause = ageRatings.length === 0 ? '0 = 1' : ageRatings.length === 3 ? '1 = 1' : `works.age_rating IN (${ageRatings.map(rating => `'${rating}'`).join(', ')})`;
  return {
    fromClause: 'FROM works',
    whereClause: `WHERE (${smart.clause}) AND ${contentClause}`,
    params: smart.params,
  };
}

function countCollectionWorks(row: ParamsObject): number {
  const query = collectionWorkQuery(row);
  const result = selectOne<CountResult>(`
    SELECT COUNT(*) AS total
    ${query.fromClause}
    ${query.whereClause}
  `, query.params);
  return Number(result?.total || 0);
}

function workMatchesSmartCollection(work: DbWork | null, row: ParamsObject): boolean {
  if (!work) return false;
  if (!collectionAgeRatings(row).includes(work.ageRating)) return false;
  const selected = parseCollectionTags(row.tags_json).map(tag => tag.toLowerCase());
  if (!selected.length) return false;
  const workTags = new Set((work.tags || []).map(tag => normalizeValue(tag?.name)));
  return row.match_logic === 'or'
    ? selected.some(tag => workTags.has(tag))
    : selected.every(tag => workTags.has(tag));
}

function collectionContainsWork(row: ParamsObject, workId: number | string, work: DbWork | null): boolean {
  if (row.type === 'smart') return workMatchesSmartCollection(work, row);
  return !!selectOne(`
    SELECT 1 AS found FROM collection_works
    WHERE collection_id = $collection_id AND work_id = $work_id
  `, { $collection_id: row.id, $work_id: workId });
}

function toCollection(row: ParamsObject, workCount: number, containsWork?: boolean): DbCollection {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    type: row.type === 'smart' ? 'smart' : 'manual',
    match: row.match_logic === 'or' ? 'or' : 'and',
    contentFilter: legacyContentFilter(collectionAgeRatings(row)),
    ageRatings: collectionAgeRatings(row),
    tags: parseCollectionTags(row.tags_json),
    workCount,
    ...(typeof containsWork === 'boolean' ? { containsWork } : {}),
    createdAt: (row.created_at as string) || null,
    updatedAt: (row.updated_at as string) || null,
  };
}

async function listCollections(ownerUserId: number, workId?: number | string): Promise<DbCollection[]> {
  await initializeDatabase();
  const rows = selectAll(`
    SELECT * FROM collections
    WHERE owner_user_id = $owner_user_id
    ORDER BY datetime(updated_at) DESC, LOWER(name) ASC, id ASC
  `, { $owner_user_id: ownerUserId });
  const work = workId === undefined ? null : await getWork(workId);

  return rows.map(row => {
    const workCount = countCollectionWorks(row);
    if (workId === undefined) return toCollection(row, workCount);
    const containsWork = collectionContainsWork(row, workId, work);
    return toCollection(row, workCount, containsWork);
  });
}

async function getCollection(ownerUserId: number, id: number | string, workId?: number | string): Promise<DbCollection | null> {
  await initializeDatabase();
  const row = getCollectionRow(ownerUserId, id);
  if (!row) return null;
  const workCount = countCollectionWorks(row);
  if (workId === undefined) return toCollection(row, workCount);
  const work = await getWork(workId);
  const containsWork = collectionContainsWork(row, workId, work);
  return toCollection(row, workCount, containsWork);
}

type CollectionInput = {
  name: string;
  type: DbCollectionType;
  match: DbCollectionMatch;
  ageRatings: AgeRating[];
  tags: string[];
};

function collectionInputParams(input: CollectionInput): ParamsObject {
  const tags = input.type === 'smart' ? normalizeCollectionTags(input.tags) : [];
  return {
    $name: input.name.trim(),
    $type: input.type,
    $match_logic: input.match,
    $content_filter: input.type === 'smart' && input.ageRatings.length === 1 ? input.ageRatings[0] : 'all',
    $age_ratings_json: JSON.stringify(input.type === 'smart' ? input.ageRatings : ALL_AGE_RATINGS),
    $tags_json: JSON.stringify(tags),
  };
}

async function createCollection(ownerUserId: number, input: CollectionInput): Promise<DbCollection> {
  await initializeDatabase();
  run(`
    INSERT INTO collections (owner_user_id, name, type, match_logic, content_filter, age_ratings_json, tags_json, created_at, updated_at)
    VALUES ($owner_user_id, $name, $type, $match_logic, $content_filter, $age_ratings_json, $tags_json, datetime('now'), datetime('now'))
  `, {
    $owner_user_id: ownerUserId,
    ...collectionInputParams(input),
  });
  const inserted = selectOne<{ id: SqlValue }>('SELECT last_insert_rowid() AS id');
  await saveNow();
  const collection = await getCollection(ownerUserId, Number(inserted?.id));
  if (!collection) throw new Error('Failed to create collection');
  return collection;
}

async function updateCollection(ownerUserId: number, id: number | string, input: CollectionInput): Promise<DbCollection | null> {
  await initializeDatabase();
  const existing = getCollectionRow(ownerUserId, id);
  if (!existing) return null;
  run(`
    UPDATE collections SET
      name = $name,
      type = $type,
      match_logic = $match_logic,
      content_filter = $content_filter,
      age_ratings_json = $age_ratings_json,
      tags_json = $tags_json,
      updated_at = datetime('now')
    WHERE id = $id AND owner_user_id = $owner_user_id
  `, {
    $id: id,
    $owner_user_id: ownerUserId,
    ...collectionInputParams(input),
  });
  if (input.type === 'smart') {
    run('DELETE FROM collection_works WHERE collection_id = $collection_id', { $collection_id: id });
  }
  await saveNow();
  return getCollection(ownerUserId, id);
}

async function deleteCollection(ownerUserId: number, id: number | string): Promise<boolean> {
  await initializeDatabase();
  const existing = getCollectionRow(ownerUserId, id);
  if (!existing) return false;
  run('DELETE FROM collections WHERE id = $id AND owner_user_id = $owner_user_id', {
    $id: id,
    $owner_user_id: ownerUserId,
  });
  await saveNow();
  return true;
}

async function setCollectionWorkMembership(
  ownerUserId: number,
  collectionId: number | string,
  workId: number | string,
  included: boolean
): Promise<DbCollection | null> {
  await initializeDatabase();
  const row = getCollectionRow(ownerUserId, collectionId);
  if (!row) return null;
  if (row.type !== 'manual') throw new Error('Smart collection membership is managed automatically');
  const work = await getWork(workId);
  if (!work) throw new Error('Work not found');
  if (included) {
    run(`
      INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at)
      VALUES ($collection_id, $work_id, datetime('now'))
    `, { $collection_id: collectionId, $work_id: workId });
  } else {
    run(`
      DELETE FROM collection_works
      WHERE collection_id = $collection_id AND work_id = $work_id
    `, { $collection_id: collectionId, $work_id: workId });
  }
  run(`
    UPDATE collections SET updated_at = datetime('now')
    WHERE id = $collection_id AND owner_user_id = $owner_user_id
  `, { $collection_id: collectionId, $owner_user_id: ownerUserId });
  await saveNow();
  return getCollection(ownerUserId, collectionId, workId);
}

type SearchCollectionWorksOptions = PaginationOptions;

async function searchCollectionWorks(
  ownerUserId: number,
  collectionId: number | string,
  options: SearchCollectionWorksOptions = {}
) {
  await initializeDatabase();
  const row = getCollectionRow(ownerUserId, collectionId);
  if (!row) return null;
  return queryWorksPage(collectionWorkQuery(row), options);
}


export {
  upsertWork,
  getWork,
  listWorks,
  getExistingWorkIds,
  attachMedia,
  deleteWork,
  searchWorks,
  searchWorkFacets,
  listCircleSummaries,
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  setCollectionWorkMembership,
  searchCollectionWorks,
};
