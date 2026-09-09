const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readdir, mkdtemp, rm } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApplication } = require('../dist');

test('application starts on an ephemeral port, reports readiness, and shuts down', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-app-'));
  const application = createApplication({
    configuration: {
      db: path.join(directory, 'database.db'),
      port: 0,
      cors: false,
      compression: false,
      public: undefined,
      pretty: true,
      sizeLimit: '1mb',
    },
    database: {
      collections: { users: { unique: ['id'] } },
    },
  });

  try {
    assert.equal(application.state, 'idle');
    await application.start();
    await application.ready();
    const response = await fetch(`http://127.0.0.1:${application.port}/api/collections`);

    assert.deepEqual(
      { state: application.state, portAssigned: application.port > 0, status: response.status },
      { state: 'ready', portAssigned: true, status: 201 },
    );
  } finally {
    await application.shutdown();
    await rm(directory, { recursive: true, force: true });
  }

  assert.equal(application.state, 'stopped');
});

test('repeated start and shutdown calls are idempotent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-app-'));
  const application = createApplication({
    configuration: {
      db: path.join(directory, 'database.db'),
      port: 0,
      public: undefined,
      pretty: true,
    },
  });

  try {
    await Promise.all([application.start(), application.start()]);
    const assignedPort = application.port;
    await application.start();
    assert.equal(application.port, assignedPort);

    await application.shutdown();
    await application.shutdown();
    assert.equal(application.state, 'stopped');
  } finally {
    await application.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('start waits for an in-progress shutdown before creating new resources', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-app-'));
  const application = createApplication({
    configuration: {
      db: path.join(directory, 'database.db'),
      port: 0,
      public: undefined,
      pretty: true,
    },
    host: '127.0.0.1',
  });

  try {
    await application.start();
    const shutdown = application.shutdown();
    const restart = application.start();
    await Promise.all([shutdown, restart]);

    const response = await fetch(`http://127.0.0.1:${application.port}/api/collections`);
    assert.deepEqual(
      { state: application.state, listening: application.port > 0, status: response.status },
      { state: 'ready', listening: true, status: 201 },
    );
  } finally {
    await application.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed listener startup closes the database for a later application', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-app-'));
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const occupiedPort = blocker.address().port;
  const databaseFile = path.join(directory, 'database.db');
  const failed = createApplication({
    configuration: { db: databaseFile, port: occupiedPort, public: undefined, pretty: true },
    host: '127.0.0.1',
  });

  try {
    await assert.rejects(failed.start(), (error) => error.code === 'EADDRINUSE');
    assert.equal(failed.state, 'failed');
    await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));

    const recovered = createApplication({
      configuration: { db: databaseFile, port: 0, public: undefined, pretty: true },
      host: '127.0.0.1',
    });
    await recovered.start();
    assert.equal(recovered.state, 'ready');
    await recovered.shutdown();
  } finally {
    if (blocker.listening) {
      await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
    }
    await failed.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('importing the library has no filesystem or listener side effects', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-import-'));
  try {
    const library = path.resolve(__dirname, '../dist');
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(library)})`], {
      cwd: directory,
      timeout: 2000,
    });

    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
