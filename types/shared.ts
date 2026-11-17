/**
 * Shared type definitions used by both server and client.
 * This file serves as the single source of truth for common data structures.
 */

// ============================================================================
// Core Entity Types
// ============================================================================

export interface Tag {
  id?: number | string;
  name: string;
}

export interface VA {
  id?: number | string;
  name: string;
}

export interface Circle {
  id?: number | string;
  name: string;
}

export interface Series {
  id?: number | string;
  name: string;
}

export interface MediaFile {
  id?: number;
  filename: string;
  filepath: string;
  mime?: string | null;
}

// ============================================================================
// Work Stats Types
// ============================================================================

/** Rating breakdown by star count (1-5 stars) */
export interface RateCountDetail {
  [key: string]: number;
}

/** Ranking entry from DLsite */
export interface RankEntry {
  term?: string;
  category?: string;
  rank?: number;
  rank_date?: string;
}

export interface WorkStats {
  dl_count?: number;
  rate_average_2dp?: number;
  rate_count?: number;
  review_count?: number;
  rank?: RankEntry[];
  rate_count_detail?: RateCountDetail | null;
}

// ============================================================================
// Work Types
// ============================================================================

export interface Work {
  id: number;
  rjcode: string;
  title?: string;
  circle?: Circle | null;
  nsfw?: boolean;
  ageRating?: AgeRating;
  release?: string;
  series?: Series | null;
  tags?: Tag[];
  vas?: VA[];
  stats?: WorkStats;
  base_dir?: string | null;
  cover_path?: string | null;
  media?: MediaFile[];
}

export type AgeRating = 'sfw' | 'r15' | 'r18';
export type NsfwFilter = 'all' | AgeRating | 'nsfw';

export interface WorkListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: Work[];
  hasNext: boolean;
  hasPrev: boolean;
}

export interface CircleSummary {
  name: string;
  count: number;
  newestWorkId?: number | string | null;
  newestCoverPath?: string | null;
  newestTitle?: string | null;
  newestRelease?: string | null;
}

// ============================================================================
// Collection Types
// ============================================================================

export type CollectionType = 'manual' | 'smart';
export type CollectionMatch = 'and' | 'or';
export type CollectionContentFilter = NsfwFilter | 'custom';

export interface Collection {
  id: number;
  name: string;
  type: CollectionType;
  match: CollectionMatch;
  contentFilter: CollectionContentFilter;
  ageRatings: AgeRating[];
  tags: string[];
  workCount: number;
  containsWork?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Settings {
  autoplayFolder?: boolean;
  defaultScanPaths?: string[];
  httpProxyHost?: string;
  httpProxyPort?: number;
  httpProxyUsername?: string;
  httpProxyPassword?: string;
  httpProxyEnabled?: boolean;
  autoScanEnabled?: boolean;
  autoScanMode?: 'interval' | 'daily';
  autoScanIntervalMinutes?: number;
  autoScanDailyTime?: string;
  timeZone?: string;
  lastScanAt?: string;
  serverLogLevels?: LogLevel[];
}

export interface ProxyCheckResult {
  ok: boolean;
  checkedAt: string;
  ip: {
    ok: boolean;
    address?: string;
    error?: string;
  };
  dlsite: {
    ok: boolean;
    status?: number;
    error?: string;
  };
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthUser {
  id: number;
  username: string;
}

// ============================================================================
// File System Types
// ============================================================================

export interface FileItem {
  name: string;
  relPath: string;
  isDir: boolean;
  isAudio?: boolean;
  isImage?: boolean;
  isVideo?: boolean;
  isPdf?: boolean;
  size?: number;
  mime?: string;
}

export interface FileListing {
  path: string;
  parent?: string | null;
  items: FileItem[];
}

// ============================================================================
// Search & Pagination Types
// ============================================================================

export interface FacetItem {
  name: string;
  count?: number;
}

export interface Facets {
  circles: FacetItem[];
  tags: FacetItem[];
  vas: FacetItem[];
}

export interface PageInfo {
  minPage: number | null;
  maxPage: number | null;
  totalPages: number | null;
  total: number;
  pageSize: number | null;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface PageEntry<T> {
  page: number;
  items: T[];
}

// ============================================================================
// Log Types
// ============================================================================

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

// ============================================================================
// Scan Progress Types
// ============================================================================

export interface ScanProgressData {
  imported?: number;
  errors?: number;
  index?: number;
  total?: number;
  retryTotal?: number;
  retryIndex?: number;
  retried?: string;
  updated?: number;
  markedMissing?: number;
  pending?: number;
  attempt?: number;
}

// ============================================================================
// UI Specific Types
// ============================================================================

export interface ViewerState {
  open: boolean;
  type?: 'image' | 'text' | 'pdf' | 'video' | null;
  title?: string;
  src?: string;
  content?: string;
}

export interface QuickSearchItem extends FacetItem {
  type: 'circle' | 'tag' | 'va';
}
