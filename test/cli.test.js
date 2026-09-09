const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const startCli = async (directory, extraEnvironment = {}) => {
  const executable = path.resolve(__dirname, '../bin/run.js');
  const child = spawn(
    process.execPath,
    [executable, '--port', '0', '--db', path.join(directory, 'database.db')],
    {
      cwd: directory,
      env: { ...process.env, LOKI_PUBLIC: '', ...extraEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CLI did not report readiness. ${stderr}`)), 3000);
    child.stdout.on('data', (data) => {
      const match = data.toString().match(/Server running on port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`CLI exited before readiness with code ${code}. ${stderr}`));
    });
  });
  return { child, port };
};

const stopCli = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  child.kill('SIGTERM');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI did not stop after SIGTERM.')), 3000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
};

test('CLI owns signal handling and shuts the application down cleanly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-cli-'));
  let child;
  try {
    ({ child } = await startCli(directory));
    assert.deepEqual(await stopCli(child), { code: 0, signal: null });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI preserves environment-based authorization settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-cli-'));
  let child;
  try {
    const started = await startCli(directory, { LOKI_AUTHZ_READ: 'reader-key' });
    child = started.child;
    const missing = await fetch(`http://127.0.0.1:${started.port}/api/collections`);
    const valid = await fetch(`http://127.0.0.1:${started.port}/api/collections`, {
      headers: { 'x-api-key': 'reader-key' },
    });

    assert.deepEqual(
      { missing: missing.status, valid: valid.status },
      { missing: 401, valid: 201 },
    );
  } finally {
    if (child) {
      await stopCli(child);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
