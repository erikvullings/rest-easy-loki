const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Koa = require('koa');
const { koaBody } = require('koa-body');

const { createCollectionAccess, createDatabaseLifecycle } = require('../dist');
const { createRouter } = require('../dist/routes');

test('HTTP routes use collection access semantics and translate its errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-routes-'));
  const database = createDatabaseLifecycle({
    file: path.join(directory, 'database.db'),
    collections: { users: { unique: ['id'] } },
  });
  await database.start();
  const collections = createCollectionAccess(database);
  let resolverCalls = 0;
  const resolver = async () => {
    resolverCalls += 1;
    return [
      { id: 'remote-1', secret: true },
      { id: 'remote-2', secret: true },
    ];
  };
  const app = new Koa();
  app.use(koaBody());
  const router = createRouter(undefined, resolver, collections);
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const resolved = await fetch(`${baseUrl}/api/users/view?props=id&from=1&to=1`);
    const created = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'alice', name: 'Alice' }),
    });
    const found = await fetch(`${baseUrl}/api/users/id/alice`);
    const invalid = await fetch(`${baseUrl}/api/users?q=${encodeURIComponent('{invalid')}`);

    assert.deepEqual(
      {
        created: { status: created.status, id: (await created.json()).id },
        found: { status: found.status, id: (await found.json()).id },
        invalid: { status: invalid.status, code: (await invalid.json()).error.code },
        resolved: { body: await resolved.json(), calls: resolverCalls },
      },
      {
        created: { status: 200, id: 'alice' },
        found: { status: 200, id: 'alice' },
        invalid: { status: 400, code: 'INVALID_FILTER' },
        resolved: { body: [{ id: 'remote-2' }], calls: 1 },
      },
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await database.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
