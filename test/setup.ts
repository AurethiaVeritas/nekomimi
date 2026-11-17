// Global test setup
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Set test environment variables
process.env.NODE_ENV = 'test';

// Create unique data directory for each test file to enable parallel execution
// Vitest provides unique task ID that we can use
const testId = process.env.VITEST_WORKER_ID || crypto.randomBytes(8).toString('hex');
const testDataDir = path.join(__dirname, `test-data-${testId}`);
const testCoverDir = path.join(__dirname, `test-covers-${testId}`);

process.env.DATA_DIR = testDataDir;
process.env.COVER_DIR = testCoverDir;

// Clean up test data before all tests in each file
beforeAll(() => {
  // Only clean if directories exist
  if (fs.existsSync(testDataDir)) {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (_err) {
      // If rmSync fails, try manual cleanup
      try {
        const files = fs.readdirSync(testDataDir);
        for (const file of files) {
          const filePath = path.join(testDataDir, file);
          try {
            fs.unlinkSync(filePath);
          } catch (_e) {
            // Ignore individual file errors
          }
        }
      } catch (_e) {
        // Ignore directory read errors
      }
    }
  }
  if (fs.existsSync(testCoverDir)) {
    try {
      fs.rmSync(testCoverDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (_err) {
      // Ignore cleanup errors for covers
    }
  }
  
  fs.mkdirSync(testDataDir, { recursive: true });
  fs.mkdirSync(testCoverDir, { recursive: true });
});

// Capture the real startup token from terminal output for integration tests.
export let accountSetupToken = '';
beforeAll(async () => {
  const { initializeAccountSetup } = await import('../server/auth.js');
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    initializeAccountSetup();
    accountSetupToken = String(output.mock.calls.at(-1)?.[0] ?? '').match(/Account setup token: ([a-f0-9]{64})/)?.[1] ?? '';
  } finally {
    output.mockRestore();
  }
});

// Clean up after all tests
afterAll(() => {
  // Clean up the unique test directories
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  if (fs.existsSync(testCoverDir)) {
    fs.rmSync(testCoverDir, { recursive: true, force: true });
  }
});
