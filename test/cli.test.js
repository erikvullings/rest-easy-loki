const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('CLI owns signal handling and shuts the application down cleanly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-cli-'));
  const database = path.join(directory, 'database.db');
  const executable = path.resolve(__dirname, '../bin/run.js');
  const child = spawn(process.execPath, [executable, '--port', '0', '--db', database], {
    cwd: directory,
    env: { ...process.env, LOKI_PUBLIC: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI did not report readiness.')), 3000);
      child.stdout.on('data', (data) => {
        if (data.toString().includes('Server running on port')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    child.kill('SIGTERM');
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI did not stop after SIGTERM.')), 3000);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    assert.deepEqual(exit, { code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});
