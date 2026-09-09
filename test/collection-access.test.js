const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCollectionAccess, createDatabaseLifecycle } = require('../dist');

const withDatabase = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-access-'));
  const database = createDatabaseLifecycle({
    file: path.join(directory, 'database.db'),
    collections: {
      users: { unique: ['id'] },
    },
  });
  try {
    await database.start();
    await run(createCollectionAccess(database));
  } finally {
    await database.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
};

test('filtering, ordering, pagination, and projection compose predictably', async () => {
  await withDatabase(async (collections) => {
    await collections.create('users', { id: 'charlie', name: 'Charlie', active: true });
    await collections.create('users', { id: 'alice', name: 'Alice', active: true });
    await collections.create('users', { id: 'bob', name: 'Bob', active: false });

    const result = await collections.query('users', {
      filter: { active: true },
      orderBy: [{ field: 'name', direction: 'asc' }],
      offset: 1,
      limit: 1,
      projection: ['id', 'name'],
    });

    assert.deepEqual(result, [{ id: 'charlie', name: 'Charlie' }]);
  });
});

test('configured unique fields provide stable identity without exposing Loki IDs', async () => {
  await withDatabase(async (collections) => {
    await collections.create('users', { id: 'alice', name: 'Alice' });

    const alice = await collections.get('users', { id: 'alice' });

    assert.equal(alice.name, 'Alice');
    await assert.rejects(
      collections.get('users', { name: 'Alice' }),
      (error) => error.code === 'INVALID_IDENTITY' && error.status === 400,
    );
    await assert.rejects(
      collections.get('users', { id: 'missing' }),
      (error) => error.code === 'RECORD_NOT_FOUND' && error.status === 404,
    );
  });
});

test('replace removes omitted fields while patch preserves them', async () => {
  await withDatabase(async (collections) => {
    await collections.create('users', { id: 'alice', name: 'Alice', role: 'reader' });

    const replaced = await collections.replace('users', { id: 'alice' }, { name: 'Alicia' });
    const patched = await collections.patch('users', { id: 'alice' }, [
      { op: 'add', path: '/role', value: 'admin' },
    ]);

    assert.deepEqual(
      {
        replaced: { id: replaced.id, name: replaced.name, role: replaced.role },
        patched: { id: patched.id, name: patched.name, role: patched.role },
      },
      {
        replaced: { id: 'alice', name: 'Alicia', role: undefined },
        patched: { id: 'alice', name: 'Alicia', role: 'admin' },
      },
    );
  });
});

test('bulk mutations stop on failure and preserve preceding successful operations', async () => {
  await withDatabase(async (collections) => {
    await collections.create('users', { id: 'alice', name: 'Alice' });

    await assert.rejects(
      collections.bulk('users', [
        { type: 'create', record: { id: 'bob', name: 'Bob' } },
        { type: 'create', record: { id: 'alice', name: 'Duplicate' } },
      ]),
      (error) => error.code === 'BULK_FAILED' && error.status === 409,
    );

    const users = await collections.query('users', {
      orderBy: [{ field: 'id', direction: 'asc' }],
      projection: ['id'],
    });
    assert.deepEqual(users, [{ id: 'alice' }, { id: 'bob' }]);
  });
});

test('invalid collection, filter, and projection inputs use stable error codes', async () => {
  await withDatabase(async (collections) => {
    const checks = [
      collections.query('../users'),
      collections.query('users', { filter: [] }),
      collections.query('users', { filter: { age: { $unknown: 18 } } }),
      collections.query('users', { projection: ['__proto__.secret'] }),
    ];

    const results = await Promise.allSettled(checks);

    assert.deepEqual(
      results.map((result) => ({
        status: result.status === 'rejected' ? result.reason.status : undefined,
        code: result.status === 'rejected' ? result.reason.code : undefined,
      })),
      [
        { status: 400, code: 'INVALID_COLLECTION' },
        { status: 400, code: 'INVALID_FILTER' },
        { status: 400, code: 'INVALID_FILTER' },
        { status: 400, code: 'INVALID_PROJECTION' },
      ],
    );
  });
});

test('stable identities reject conflicting replacements and support deletion', async () => {
  await withDatabase(async (collections) => {
    await collections.create('users', { id: 'alice', name: 'Alice' });
    await collections.create('users', { id: 'bob', name: 'Bob' });

    await assert.rejects(
      collections.replace('users', { id: 'alice' }, { id: 'bob', name: 'Alice' }),
      (error) => error.code === 'IDENTITY_CONFLICT' && error.status === 409,
    );
    const deleted = await collections.delete('users', { id: 'alice' });
    await assert.rejects(
      collections.get('users', { id: 'alice' }),
      (error) => error.code === 'RECORD_NOT_FOUND' && error.status === 404,
    );
    assert.equal(deleted.id, 'alice');
  });
});
