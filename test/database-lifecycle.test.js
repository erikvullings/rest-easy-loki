const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, unlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDatabaseLifecycle, db } = require('../dist');

const withTempDirectory = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('startup becomes ready after configured collections and imports are complete', async () => {
  await withTempDirectory(async (directory) => {
    const importFile = path.join(directory, 'users.json');
    await writeFile(importFile, JSON.stringify([{ id: 'alice' }, { id: 'bob' }]));
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: {
          jsonImport: importFile,
          unique: ['id'],
        },
      },
    });

    assert.equal(database.state, 'idle');
    await database.start();
    await database.ready();

    assert.equal(database.state, 'ready');
    assert.deepEqual(database.collections(), [{ name: 'users', entries: 2 }]);
    await database.shutdown();
    assert.equal(database.state, 'stopped');
  });
});

test('existing databases load without repeating their original imports', async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, 'database.db');
    const importFile = path.join(directory, 'users.json');
    const options = {
      file,
      collections: {
        users: {
          jsonImport: importFile,
          unique: ['id'],
        },
      },
    };
    await writeFile(importFile, JSON.stringify([{ id: 'alice' }]));

    const first = createDatabaseLifecycle(options);
    await first.start();
    await first.shutdown();
    await unlink(importFile);

    const reopened = createDatabaseLifecycle(options);
    await reopened.start();

    assert.deepEqual(reopened.collections(), [{ name: 'users', entries: 1 }]);
    await reopened.shutdown();
  });
});

test('malformed JSON rejects startup with collection and filename context', async () => {
  await withTempDirectory(async (directory) => {
    const importFile = path.join(directory, 'broken.json');
    await writeFile(importFile, '[invalid');
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: { jsonImport: importFile },
      },
    });

    await assert.rejects(database.start(), (error) => {
      assert.match(error.message, /parse JSON import/);
      assert.match(error.message, /users/);
      assert.match(error.message, /broken\.json/);
      return true;
    });
    assert.equal(database.state, 'failed');
  });
});

test('missing JSON imports reject startup with collection and filename context', async () => {
  await withTempDirectory(async (directory) => {
    const importFile = path.join(directory, 'missing.json');
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: { jsonImport: importFile },
      },
    });

    await assert.rejects(database.start(), (error) => {
      assert.match(error.message, /import collection/);
      assert.match(error.message, /users/);
      assert.match(error.message, /missing\.json/);
      return true;
    });
  });
});

test('duplicate unique values reject startup with collection context', async () => {
  await withTempDirectory(async (directory) => {
    const importFile = path.join(directory, 'duplicates.json');
    await writeFile(importFile, JSON.stringify([{ id: 'alice' }, { id: 'alice' }]));
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: {
          jsonImport: importFile,
          unique: ['id'],
        },
      },
    });

    await assert.rejects(database.start(), (error) => {
      assert.match(error.message, /insert JSON import/);
      assert.match(error.message, /users/);
      assert.match(error.message, /Duplicate key/);
      return true;
    });
  });
});

test('rebuild removes existing partitions and recreates configured data', async () => {
  await withTempDirectory(async (directory) => {
    const importFile = path.join(directory, 'users.json');
    await writeFile(importFile, JSON.stringify([{ id: 'alice' }]));
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: {
          jsonImport: importFile,
          unique: ['id'],
        },
      },
    });
    await database.start();
    await writeFile(importFile, JSON.stringify([{ id: 'bob' }, { id: 'charlie' }]));

    await database.rebuild();

    assert.deepEqual(database.collections(), [{ name: 'users', entries: 2 }]);
    await database.shutdown();
  });
});

test('shutdown interrupts startup before readiness is reported', async () => {
  await withTempDirectory(async (directory) => {
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: {
        users: {},
      },
    });

    const startup = database.start();
    await database.shutdown();

    await assert.rejects(startup, /interrupted by shutdown/);
    assert.equal(database.state, 'stopped');
  });
});

test('start waits for an in-progress shutdown before reopening the database', async () => {
  await withTempDirectory(async (directory) => {
    const database = createDatabaseLifecycle({
      file: path.join(directory, 'database.db'),
      collections: { users: {} },
    });
    await database.start();

    const shutdown = database.shutdown();
    const restart = database.start();
    await Promise.all([shutdown, restart]);

    assert.equal(database.state, 'ready');
    assert.deepEqual(database.collections(), [{ name: 'users', entries: 0 }]);
    await database.shutdown();
  });
});

test('shutdown persists pending changes before an existing database is reopened', async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, 'database.db');
    await db.startDatabase(file);
    db.post('users', { id: 'alice' });

    await db.shutdownDatabase();
    await db.startDatabase(file);

    assert.equal(db.all('users').length, 1);
    await db.shutdownDatabase();
  });
});

test('an existing database with no collections can be reopened', async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, 'database.db');
    const first = createDatabaseLifecycle({ file });
    await first.start();
    await first.shutdown();

    const reopened = createDatabaseLifecycle({ file });
    await Promise.race([
      reopened.start(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('empty database reopen timed out')), 100)),
    ]);

    assert.deepEqual(reopened.collections(), []);
    await reopened.shutdown();
  });
});

test('rebuild preserves unrelated files that share the database filename prefix', async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, 'database.db');
    const backup = `${file}.backup`;
    await writeFile(backup, 'keep');
    const database = createDatabaseLifecycle({ file, rebuild: true });

    await database.start();

    assert.equal(await readFile(backup, 'utf8'), 'keep');
    await database.shutdown();
  });
});
