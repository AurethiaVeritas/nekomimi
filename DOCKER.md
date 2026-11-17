Nekomimi Docker

The public image `ghcr.io/aurethiaveritas/nekomimi:edge` includes the server and built React client, with AMD64 and ARM64 support. No image build or registry login is required. The repository also includes a multi-stage Dockerfile for optional source builds.

Quick start

- Download [docker-compose.yml](docker-compose.yml), configure your media mount as described below, and create the bind-mount directories as your current user. Pull and run the published image with Compose:

  - `mkdir -p data cover`
  - `docker compose pull`
  - `NEKOMIMI_UID="$(id -u)" NEKOMIMI_GID="$(id -g)" docker compose up -d`
  - Open http://localhost:3000

The container runs without root privileges. The image defaults to the `node` user
(UID/GID 1000), while the Compose file accepts `NEKOMIMI_UID` and
`NEKOMIMI_GID` so bind mounts can use the Docker host user's numeric IDs.

What’s included

- Single container running Node.js server (`dist/server/index.js`).
- Image-level health check against the unauthenticated `/api/health` endpoint. Docker
  reports the container as healthy after the server begins responding successfully.
- Client (Vite + React) is built in the image and served from `client/dist`.
- Persistent volumes:
  - `./data` mounted at `/data` for the SQLite DB (`nekomimi.db`) and `settings.json`.
  - `./cover` mounted at `/app/cover` for cover images the server downloads or copies.

Authentication reset

- To wipe local authentication (users and session secret) on the host:
  - `npm run reset-auth`
  - Then restart the server and open `/login` to initialize a new admin.
- In Docker, run inside the container (with the same volume mounted at `/data`):
  - `docker compose exec nekomimi node dist/server/reset-auth.js --yes`
  - Restart the container afterwards.

If ownership or permissions are incorrect, the server exits before listening and
prints the affected path and its runtime UID/GID, for example:

```text
[startup] Required data directory "/data" is not readable and writable by UID 1000, GID 1000. Check the ownership and permissions of the host bind mount.
```

The startup check covers the data and cover directories, a custom database parent
directory, and existing database, settings, user, and authentication-secret files.

Media library mounting

- If you want the scanner and player to access your media library from the container, mount your host directory into the container (read-only is recommended):

  - Edit `docker-compose.yml` and add a volume under the service, for example:
    - `/absolute/path/to/your/library:/library:ro`
  - In the app settings (UI), set `defaultScanPaths` to `/library` (or its subfolders). Scanning should be performed while the container is running to ensure stored file paths match the container mount path.

Environment variables

- Tweak runtime via these env vars (see `config/index.ts`):
  - `PORT` (default `3000`)
  - `DATA_DIR` (default `/data` in the compose file)
  - `COVER_DIR` (default `cover`; set to an absolute path like `/app/cover` in production services)
  - `MAX_COVER_BYTES` (default `10485760`, or 10 MiB)
  - `TEMP_COVER_TTL_HOURS` (default `24`)
  - `HTTP_PROXY_HOST`, `HTTP_PROXY_PORT` for outbound HTTP(S) proxy used by scrapers
  - `HTTP_RETRY_LIMIT`, `HTTP_RETRY_DELAY_MS`, `DLSITE_TIMEOUT_MS`, `HVDB_TIMEOUT_MS`

Reverse proxy setup

- The server has `trust proxy` enabled, allowing it to work correctly behind nginx, Cloudflare, or other reverse proxies.
- Supported proxy headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, `X-Real-IP`
- Example nginx configuration:

  ```nginx
  location /nekomimi/ {
      proxy_pass http://localhost:3000/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host $host;
      
      # For SSE streams (scan events)
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 24h;
  }
  ```

- When behind HTTPS proxy, authentication cookies will work correctly as the server reads `X-Forwarded-Proto` to detect secure connections.

Manual docker build/run

- Building is optional. For a source build, clone the repository and run the following from its root. To use Compose with a source build, uncomment the `build` block in `docker-compose.yml`, change `image` to `nekomimi-asmr:latest`, then use `docker compose up --build -d` with the same UID/GID settings as above.
- Build: `docker build -t nekomimi-asmr .`
- Prepare bind mounts: `mkdir -p data cover`
- Run: `docker run --rm --user "$(id -u):$(id -g)" -p 3000:3000 \
    -e NODE_ENV=production -e DATA_DIR=/data \
    -v "$PWD/data:/data" -v "$PWD/cover:/app/cover" \
    nekomimi-asmr`
- Inspect health status with `docker inspect --format '{{.State.Health.Status}}' <container>`.

Notes

- Cover images are written under `cover/` (mounted to `/app/cover`) and will persist across container restarts when using the provided compose file.
- Read-only media-library mounts must still grant the container UID/GID permission to traverse directories and read media files.
- If you override `DATA_DIR`, `COVER_DIR`, or `DB_PATH`, their directories must be readable and writable by the configured container user.
- Keep the internal `PORT` at 1024 or above for rootless operation. Mapping a privileged host port such as `80:3000` is supported.

### First account setup

When no valid account exists, read the account setup token with `docker compose logs nekomimi`. Open `/login`, choose **Initialize admin**, and verify the token first. On the next screen, enter a username and a password of at least 12 characters. The token changes on each restart until setup succeeds and is invalidated afterward. Keep container logs private. After resetting authentication, restart the container and use its newly printed token.

### Public GitHub images

The public workflow is `.github/workflows/publish-image.yml`. It runs only on GitHub and is included in the public source sync along with the Dockerfile, `.dockerignore`, Compose file, and both npm lockfiles. The private Forgejo workflows are not exported.

Pull requests run type checks, tests, and a Docker build without logging in or publishing. Changes to build inputs on `main`, or a manual run on `main`, publish `ghcr.io/<owner>/<repository>:edge` and a `sha-<commit>` tag. Version tags such as `v1.0.0` publish `:1.0.0` and, for stable versions, `:latest`. Prerelease tags do not update `:latest`. Release tags must match the root `package.json` version; update that version and sync the source before tagging the public GitHub commit. The source sync does not copy private Git history or tags.

Images support `linux/amd64` and `linux/arm64`. Publishing uses GitHub's built-in `GITHUB_TOKEN` with `packages: write`; no private registry credentials or personal access token are needed. After the first publish, set the GHCR package visibility to public if anonymous pulls are intended.

To deploy a published version, set Compose's `image:` to `ghcr.io/<owner>/<repository>:<version>` (using lowercase names), then run `docker compose pull` and `docker compose up -d`. Keep the existing persistent data, cover, and media mounts.
