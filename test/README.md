# Testing Guide

This project uses Vitest and Supertest. Run commands from the repository root after installing dependencies with `npm install` and `npm --prefix client install`.

## Running Tests

```bash
npm test
npm test -- test/api/works.test.ts
npm run test:watch
npm run test:coverage
```

`vitest.config.ts` enables TypeScript tests, the Node environment, and Vitest globals. API integration tests live in `test/api/`; unit tests live in `test/unit/`. `test/helpers/auth.ts` supplies authentication helpers.

## Isolation and Authentication

`test/setup.ts` assigns each worker disposable `DATA_DIR` and `COVER_DIR` directories, initializes the account setup token, and removes the storage after the suite. Test files can run in parallel. Never point tests or manual QA at the repository's real `data/` or `cover/` directories.

Use `bootstrapTestUser` to create an account and obtain a cookie. Give each suite a unique username. Subsequent requests to protected API endpoints must include the cookie:

```typescript
import request from 'supertest';
import app from '../../server/index';
import { bootstrapTestUser } from '../helpers/auth';

let cookie: string;

beforeAll(async () => {
  const auth = await bootstrapTestUser(request(app), 'my-api-suite-user');
  cookie = auth.cookie!;
});

it('lists works for an authenticated user', async () => {
  const res = await request(app)
    .get('/api/works')
    .set('Cookie', cookie);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.items)).toBe(true);
});
```

Use `loginTestUser` for an existing account. `signTestJWT` can generate signed tokens for claim-validation tests; `createAuthCookie` reads the secret from an isolated test directory. A valid token must refer to an existing user for authenticated API tests.

## Behavior Checks

Test both successful requests and relevant failure cases, including authentication and path boundaries. Mock scraper providers and outbound HTTP requests when exercising imports so tests do not depend on live services.

Import and scan changes should verify local media paths, `base_dir`, and cover copying with sample files in isolated storage. For a fixture needed by only one suite, create it under that suite's `DATA_DIR` or `COVER_DIR` so setup cleanup removes it automatically. Tests that create fixtures elsewhere must remove them explicitly.

Supertest starts disposable HTTP listeners and does not require the development server to be running. If the execution environment restricts local sockets, allow loopback listeners before running API tests.

## Coverage and Other Checks

`npm run test:coverage` writes reports to `coverage/`, including `coverage/lcov-report/index.html`. Coverage includes TypeScript source under `server/`, `scraper/`, and `filesystem/`; it excludes `server/reset-auth.ts` and test files.

```bash
npm run lint
npm run typecheck
npm --prefix client run typecheck
npm run build
```

For manual/browser QA, start the API with disposable storage and inspect affected interactions and responsive layouts. See the isolated QA workflow in the repository's coding-agent guidance.
