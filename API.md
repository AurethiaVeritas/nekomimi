# Nekomimi HTTP API

This document describes the HTTP API exposed by the Nekomimi ASMR server so you can build your own front‑end.

- Base URL: http://localhost:3000 (or your host/port)
- All JSON endpoints live under `/api/*`.
- Authentication: cookie-based (JWT in `auth` cookie). Most API routes require auth.
- Content type: send `Content-Type: application/json` for JSON bodies unless noted.
- Errors: non-2xx responses include `{ "error": "message" }`.

Tip: When using `fetch` in a browser, include `credentials: 'include'` so cookies are sent.

OpenAPI and Swagger

- GET `/api/openapi.json`
  - Public machine-readable OpenAPI 3.1 document for the HTTP API.
- GET `/api/docs`
  - Public Swagger UI page that renders `/api/openapi.json`.

Auth endpoints

- POST `/api/auth/setup-token`
  - Body: `{ setupToken: string }`
  - Validates the startup token before displaying account credentials in the Web UI. Returns `{ ok: true }` without creating an account or session or consuming the token.
  - Fails with 403 for a missing/invalid token or 400 if already initialized. Uses the authentication rate limiter.
  - The bootstrap request must still include the token; restarting the server invalidates a previously verified token.
- POST `/api/auth/bootstrap`
  - Body: `{ username: string, password: string, setupToken: string }`
  - Initializes the first admin user. Returns `{ user }` and sets auth cookie.
  - Requires the token printed in the server terminal when no valid account exists. It is regenerated on every restart until setup succeeds, then invalidated; it is never returned by an HTTP endpoint.
  - Fails with 403 for a missing or invalid setup token, or 400 if already initialized or credentials are invalid.
- POST `/api/auth/login`
  - Body: `{ username: string, password: string }`
  - On success returns `{ user }` and sets auth cookie.
- POST `/api/auth/logout`
  - Clears the auth cookie and revokes every issued token for the account. Returns `{ ok: true }`.
- GET `/api/auth/me`
  - Returns `{ user }` if logged in, otherwise 401 with `{ user: null }`.
- POST `/api/auth/change-password`
  - Body: `{ currentPassword: string, newPassword: string }`
  - Changes password of the current user.
  - Revokes all previously issued tokens and sets a replacement cookie for the current client.

Health

- GET `/api/health` → `{ ok: true }`
  - Public; no auth required.

Settings

- GET `/api/settings` → current settings object (JSON)
- PUT `/api/settings` → updates any subset of fields below:
  - `autoplayFolder: boolean`
  - `defaultScanPaths: string[]` (absolute paths visible to server)
  - `httpProxyEnabled?: boolean` (enable/disable scraper proxy)
  - `httpProxyHost?: string` (scraper outbound proxy)
  - `httpProxyPort?: number`
  - `httpProxyUsername?: string`
  - `httpProxyPassword?: string`
  - `autoScanEnabled?: boolean` (server auto-scans in background)
  - `autoScanMode?: 'interval' | 'daily'`
  - `autoScanIntervalMinutes?: number` (>=1)
  - `autoScanDailyTime?: 'HH:MM'` (24h, in the configured timezone)
  - `timeZone?: string` (IANA timezone, e.g. `America/New_York`; defaults to the detected browser/server timezone, then `UTC` if detection fails; used by daily scans and server-log display)
  - `serverLogLevels?: ('info'|'warn'|'error')[]` (levels emitted, buffered, and streamed by the server; defaults to all levels)
  - Read-only fields that may be present: `lastScanAt: string (ISO)`
- POST `/api/settings/proxy-check` → checks scraper outbound networking through the configured proxy path:
  - `ip`: result from `https://ipconfig.org` including the detected outbound address
  - `dlsite`: whether `https://www.dlsite.com/` is reachable, including HTTP status when available

Logs

- GET `/api/logs` → `{ logs: LogEntry[] }`
  - Returns recent server logs (up to 500 most recent entries).
  - Query params:
    - `limit?: number` (default: 100, max: 500) - number of log entries to return
  - LogEntry format: `{ level: 'info'|'warn'|'error', message: string, timestamp: string (ISO) }`
- GET `/api/logs/stream` → Server-Sent Events stream
  - By default, streams all existing logs immediately, then streams new logs in real-time.
  - Query params:
    - `history?: boolean` (default: `true`) - when `false`, only new logs are streamed
  - Each event contains: `data: { level, message, timestamp }`
  - Use EventSource API: `new EventSource('/api/logs/stream')`

Works

- GET `/api/works`
  - Returns `{ page, pageSize, total, totalPages, items, hasNext, hasPrev }`.
  - Query params (all optional):
    - `page?: number` — defaults to 1.
    - `pageSize?: number` — defaults to 24 and is clamped to a maximum of 200; values <1 fall back to the default.
    - `q?: string` — fuzzy matches title/circle/tags/VAs.
    - `ageRating?: ('sfw'|'r15'|'r18')[]` — repeatable selected ratings, for example `?ageRating=sfw&ageRating=r15`. `ageRating=none` selects no ratings. Omit for all three. Takes precedence over `nsfw`.
    - `nsfw?: 'all'|'sfw'|'r15'|'r18'|'nsfw'` — legacy single rating filter; `nsfw` is an alias for `r18`.
    - `sort?: 'release_desc'|'release_asc'|'title_asc'|'title_desc'|'updated_desc'` — defaults to `updated_desc`.
    - `circle?: string|string[]` — repeatable query param, filters by circle names.
    - `tag?: string|string[]` — repeatable query param, filters by tag names.
    - `va?: string|string[]` — repeatable query param, filters by voice actor names.
  - Text search and name filters trim whitespace and use Unicode lowercase matching while preserving stored spelling for display.
- GET `/api/works/facets`
  - Returns `{ circles, tags, vas }` facet counts for the filtered, unpaginated works dataset.
  - Each tag/VA count represents distinct works, so duplicate entries in one work do not inflate it. Tag/VA names are grouped using the same normalized text as filters and smart collections.
  - Query params (all optional):
    - `q?: string` — fuzzy matches title/circle/tags/VAs.
    - `ageRating?: ('sfw'|'r15'|'r18')[]` — same repeatable rating selection as `/api/works`, including `none`.
    - `nsfw?: 'all'|'sfw'|'r15'|'r18'|'nsfw'` — legacy single rating filter.
    - `circle?: string|string[]` — repeatable query param, filters by circle names.
    - `tag?: string|string[]` — repeatable query param, filters by tag names.
    - `va?: string|string[]` — repeatable query param, filters by voice actor names.
- GET `/api/circles` → `CircleSummary[]`
  - Returns aggregated circle data optimized for circles list view
  - Query params:
    - `ageRating?: ('sfw'|'r15'|'r18')[]` — same repeatable rating selection as `/api/works`, including `none`.
    - `nsfw?: 'all'|'sfw'|'r15'|'r18'|'nsfw'` — legacy single rating filter; `nsfw` aliases `r18`.
    - `sort?: 'name_asc'|'name_desc'|'count_desc'|'count_asc'` (default: 'name_asc') - sort order
  - Response: array of `{ name: string, count: number, newestWorkId: number, newestCoverPath: string, newestTitle: string, newestRelease: string }`
  - Much faster than fetching all works client-side for circle grouping
- GET `/api/works/:id` → `Work`
- PUT `/api/works/:id`
  - Body supports partial update of fields:
  - `title?: string`
  - `circle?: { name: string }`
  - `nsfw?: boolean`
  - `ageRating?: 'sfw'|'r15'|'r18'` — takes precedence over `nsfw`; legacy `nsfw: true` maps to R-18.
  - `release?: string (YYYY-MM-DD)`
  - `series?: { name: string } | null`
  - `tags?: { id?: number, name: string }[]`
  - `vas?: { id?: string, name: string }[]`
  - `stats?: object`
  - `base_dir?: string` (absolute path)
  - `cover_path?: string` (absolute path on server)
  - Returns updated `Work`.
- DELETE `/api/works/:id` → `{ ok: true }` (does not delete media files on disk)
- POST `/api/works/:id/media`
  - Body: `{ files: string[] }` of absolute file paths on server (or mounted volume)
  - Attaches audio files; returns updated `Work`.
- POST `/api/works/:id/align`
  - Searches configured `defaultScanPaths` and updates the work path without re-scraping metadata.
  - Re-links an existing managed `cover/RJ{id}.*` file when the database cover link was cleared.
  - When a mounted-storage directory is listed but cannot be opened, returns `200` with `repairRequired: true`, `issueCode: 'SMB_FILENAME_UNREACHABLE'`, and a `suggestedPath`. Rename the directory at the storage source (or correct the share filename-encoding setting), reconnect the storage, then run alignment again.

Collections

Collections are scoped to the authenticated user. A user cannot read or modify another user's collections, even when they know a collection id.

- GET `/api/collections` → `Collection[]`
  - Returns the current user's collections, ordered by most recently updated.
  - Query params:
    - `workId?: number` — includes `containsWork` on each result for the specified work. Smart membership is calculated from that work's current tags and content rating.
- POST `/api/collections` → `Collection` with status `201`
  - Manual body: `{ name: string, type?: 'manual' }`
  - Smart body: `{ name: string, type: 'smart', match?: 'and'|'or', ageRatings?: ('sfw'|'r15'|'r18')[], tags: string[] }`
  - `match: 'and'` requires every selected tag; `match: 'or'` requires at least one selected tag. The default is `and`.
  - `ageRatings` selects any combination; `[]` matches no works. Defaults to all three. Legacy `contentFilter` still accepts one rating or `all`; `nsfw` maps to `r18`. When both fields are sent, `ageRatings` takes precedence.
  - Names are required, limited to 100 characters, and unique per user ignoring case.
  - Smart collections require 1–50 tags. Each tag is limited to 80 characters; duplicate names are removed ignoring case.
- GET `/api/collections/:id` → `Collection`
- PUT `/api/collections/:id` → `Collection`
  - Body may include `name`, `type`, `match`, `ageRatings`, legacy `contentFilter`, or `tags`; omitted fields retain their current values.
  - Changing a manual collection to smart removes its stored manual memberships.
- DELETE `/api/collections/:id` → `{ ok: true }`
  - Deletes stored memberships with the collection. Work records and media files are not deleted.
- GET `/api/collections/:id/works`
  - Returns `{ page, pageSize, total, totalPages, items, hasNext, hasPrev }`.
  - Query params: `page`, `pageSize` (maximum 200), and `sort` using the same values as `/api/works`.
  - Manual collections return explicitly added works. Smart collections are evaluated from current work tags and content filter on every request, so their results update automatically when either changes.
- PUT `/api/collections/:id/works/:workId` → `Collection`
  - Body: `{ included: boolean }` — `true` adds the work and `false` removes it.
  - Manual collections only. Smart membership is controlled by the collection's tag rules and returns `400` if changed directly.

Import (scrape + create)

- POST `/api/import/dlsite`
  - Body: `{ id: number|string, language?: 'ja-jp'|'zh-tw'|'zh-cn', mediaPath?: string, coverPath?: string }`
  - `id` is RJ digits (6 or 8) or any string containing them.
  - `mediaPath` may be a directory (preferred) or a single audio file.
  - `coverPath` is an absolute image path on the server (see Cover upload below).
  - Returns created `Work` (or updated if already exists).

File listing and streaming

- GET `/api/works/:id/files?p=relative/subdir`
  - Lists directory contents under a work’s `base_dir`.
  - Response: `{ base, path, parent, items: [{ name, isDir, size, mtime, relPath, mime, isAudio, isImage }] }`
  - `parent` is relative to `base` and is `null` at the library root or when the parent is the root.
  - Returns `409` with `code: 'SMB_FILENAME_UNREACHABLE'` and a suggested safe path when mounted storage lists a directory name that the host filesystem cannot open.
- GET `/files/:id/:filePath`
  - Serves an arbitrary file under `base_dir` with Range support. `filePath` may include nested segments.
  - URL-encode each path segment once; literal percent signs and percent-like filenames are preserved.
- GET `/media/:id/:filename`
  - Streams an audio file in `work.media` with Range support.
- File paths are resolved canonically. Symlinks below a configured library root are rejected; configure or mount the canonical target as a root instead.
- Range requests support one closed, open-ended, or suffix byte range. Invalid or multiple ranges return `416` with `Content-Range: bytes */<size>`.

Cover images

- GET `/cover/:id`
  - Streams the work cover image. 404 if not set.
- POST `/api/cover/temp?filename=name.jpg`
  - Body: raw bytes (image). Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.webp`.
  - The body must match the filename extension and is limited by `MAX_COVER_BYTES` (10 MiB by default). Temporary files expire after `TEMP_COVER_TTL_HOURS` (24 hours by default), with cleanup at startup and on later temporary uploads.
  - Returns `{ path }` (absolute server path) for use as `coverPath` in import.
  - Import deletes the temporary file only after successfully copying it into managed cover storage; failed copies remain until expiry.
- POST `/api/works/:id/cover?filename=name.jpg`
  - Body: raw bytes (image). The signature must match the extension and the same cover-size limit applies. Validation completes in a staging file before the active cover is atomically replaced.

Scanning

- POST `/api/scan`
  - Body: `{ path?: string|string[], language?: string, dryRun?: boolean, newOnly?: boolean, metadataOnly?: boolean }`
  - If `path` omitted, uses `defaultScanPaths` from settings.
  - `newOnly` defaults to `true` (scan/import only newly detected IDs).
  - Set `newOnly: false` to explicitly re-scrape existing works.
  - Set `metadataOnly: true` to re-fetch metadata for existing works only without updating file attachments or covers.
  - Response (when not `dryRun`): `{ paths, invalidPaths, imported: { id, title, mediaPath }[], errors: { id, mediaPath, error }[], invalidUpdated, mode }`
- GET `/api/scan/active` → `{ jobId: string|null, status: 'running'|'done'|'error'|'idle' }`
- POST `/api/scan/start`
  - Starts a scan job and returns `{ jobId, status }`. Uses query/default paths.
- GET `/api/scan/stream`
  - Server‑Sent Events (SSE) live stream for a new or existing job.
  - Query params mirror `/api/scan` (`path`, `language`, `dryRun`, `newOnly`, `metadataOnly`).
  - `newOnly` defaults to `true`; pass `newOnly=false` for manual re-scan of existing works.
  - Pass `metadataOnly=true` to update metadata for existing works only.
  - Events:
    - `start`: `{ paths: string[], invalidPaths: string[], total: number, mode }`
    - `progress`: `{ index, total, id, rjcode, title, mediaPath, imported, errors, mode }`
    - `retry`: `{ attempt, pending, mode }`
    - `scan_error`: `{ id?, mediaPath?, error, mode? }`
    - `invalid_cover`: `{ count, items: { id, rjcode, title }[], mode }`
    - `done`: `{ imported: number, errors: number, mode }`
- GET `/api/scan/jobs/:id/stream`
  - SSE stream for a specific existing job id.
- GET `/api/scan/alignment`
  - Alignment scan: updates file paths for all existing works without re-scraping metadata.
  - Query params: `language` (optional).
  - Uses `defaultScanPaths` from settings.
  - SSE events:
    - `start`: `{ paths: string[], total: number, mode: 'alignment' }`
    - `progress`: `{ index, total, id, rjcode, title, status: 'updated'|'missing'|'unchanged', updated, markedMissing, errors }`
    - `scan_error`: `{ index, total, id, error, updated, markedMissing, errors }`
    - `done`: `{ updated: number, markedMissing: number, errors: number, mode: 'alignment' }`

Data shapes

Work

```
{
  id: number,
  rjcode: string,            // zero-padded
  title: string,
  circle: { name: string },
  nsfw: boolean,
  ageRating: 'sfw' | 'r15' | 'r18', // nsfw is true only for r18
  release: string,           // YYYY-MM-DD
  series?: { name: string },
  tags: [{ id?: number, name: string }],
  vas: [{ id?: string, name: string }],
  stats: {
    dl_count: number,
    rate_average_2dp: number,
    rate_count: number,
    review_count: number,
    rank: number[],
    rate_count_detail?: any
  },
  media: [{ filename: string, filepath: string, mime?: string }],
  base_dir?: string,
  cover_path?: string
}
```

Collection

```
{
  id: number,
  name: string,
  type: 'manual' | 'smart',
  match: 'and' | 'or',
  ageRatings: ('sfw' | 'r15' | 'r18')[],
  contentFilter: 'sfw' | 'r15' | 'r18' | 'all' | 'custom', // legacy summary; custom means use ageRatings
  tags: string[],
  workCount: number,
  containsWork?: boolean,    // present when querying membership for a work
  createdAt?: string,
  updatedAt?: string
}
```

Auth and CORS notes

- The server uses cookie auth. From a browser, calls must include credentials. Example:
  - `fetch('/api/works', { credentials: 'include' })`
- Cross‑origin requests (different scheme/host/port) are not enabled by default. Use a reverse proxy to serve your UI and the API under the same origin, or add CORS in `server/index.ts` for your deployment.

Examples

Login

```
curl -i -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"secret"}' \
  http://localhost:3000/api/auth/login
```

List works

```
curl -b cookies.txt http://localhost:3000/api/works
```

Create a smart collection

```
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Sleep & Relax","type":"smart","match":"and","ageRatings":["sfw","r15"],"tags":["Whispering","Sleep"]}' \
  http://localhost:3000/api/collections
```

Add a work to a manual collection

```
curl -X PUT -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"included":true}' \
  http://localhost:3000/api/collections/1/works/123
```

Start a scan (default: new only)

```
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{}' \
  http://localhost:3000/api/scan
```

Rescan all (include existing works)

```
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"newOnly":false}' \
  http://localhost:3000/api/scan
```

Rescrape metadata for existing works only

```
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"metadataOnly":true}' \
  http://localhost:3000/api/scan
```

Upload a temporary cover

```
curl -b cookies.txt --data-binary @cover.jpg \
  'http://localhost:3000/api/cover/temp?filename=cover.jpg'
```

Versioning & limits

- The API is currently unversioned and subject to change.
- No rate limits are enforced by the server.
