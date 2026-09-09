const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { configurationFromEnvironment, createApplication, validateConfiguration } = require('../dist');

test('the CLI environment adapter produces typed configuration without global state', () => {
  const source = {
    LOKI_PORT: '3030',
    LOKI_DB: 'custom.db',
    LOKI_CORS: 'false',
    LOKI_COMPRESSION: 'true',
    LOKI_AUTHZ_READ: 'reader,admin',
    LOKI_PUBLIC_VALUE: '42',
  };

  const configuration = configurationFromEnvironment(source);

  assert.deepEqual(
    {
      port: configuration.port,
      db: configuration.db,
      cors: configuration.cors,
      compression: configuration.compression,
      authorization: configuration.authorization,
      environment: configuration.environment,
    },
    {
      port: 3030,
      db: 'custom.db',
      cors: false,
      compression: true,
      authorization: {
        mode: 'apiKey',
        keys: { create: [], read: ['READER', 'ADMIN'], update: [], delete: [] },
        whitelist: [],
        publicRoutes: [],
      },
      environment: {
        LOKI_PORT: 3030,
        LOKI_DB: 'custom.db',
        LOKI_CORS: false,
        LOKI_COMPRESSION: true,
        LOKI_PUBLIC_VALUE: 42,
      },
    },
  );
});

test('conflicting authentication modes fail before database startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-config-'));
  const application = createApplication({
    configuration: {
      db: path.join(directory, 'database.db'),
      port: 0,
      authorization: {
        mode: 'jwt',
        sharedSecret: 'secret',
        jwksUrl: 'https://example.test/.well-known/jwks.json',
        rules: [{ method: 'GET', path: '/api/*' }],
      },
    },
  });

  try {
    await assert.rejects(application.start(), /exactly one of sharedSecret or jwksUrl/);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await application.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated configuration fills behavior-safe defaults', () => {
  const configuration = validateConfiguration({ db: 'app.db' });

  assert.deepEqual(
    {
      port: configuration.port,
      cors: configuration.cors,
      compression: configuration.compression,
      io: configuration.io,
      sizeLimit: configuration.sizeLimit,
      authorization: configuration.authorization,
    },
    {
      port: 3000,
      cors: true,
      compression: true,
      io: false,
      sizeLimit: '250mb',
      authorization: { mode: 'none', publicRoutes: [] },
    },
  );
});

test('invalid and incomplete authentication settings fail with actionable errors', () => {
  const checks = [
    () =>
      validateConfiguration({
        db: 'app.db',
        authorization: { mode: 'apiKey', keys: {} },
      }),
    () =>
      validateConfiguration({
        db: 'app.db',
        authorization: { mode: 'jwt', sharedSecret: 'secret' },
      }),
    () =>
      configurationFromEnvironment({
        LOKI_AUTHZ_JWT_SHARED: 'secret',
        LOKI_AUTHZ_READ: 'reader',
      }),
    () =>
      validateConfiguration({
        db: 'app.db',
        authorization: { mode: 'apiKey', keys: { read: ['reader'] }, whitelist: ['trusted.example'] },
      }),
  ];

  assert.deepEqual(
    checks.map((check) => {
      try {
        check();
        return undefined;
      } catch (error) {
        return { code: error.code, message: error.message };
      }
    }),
    [
      { code: 'INVALID_CONFIGURATION', message: 'API-key mode requires at least one key.' },
      {
        code: 'INVALID_CONFIGURATION',
        message: 'JWT mode requires authorization rules, anonymous reads, or public routes.',
      },
      {
        code: 'INVALID_CONFIGURATION',
        message: 'JWT and API-key environment settings cannot be combined.',
      },
      {
        code: 'INVALID_CONFIGURATION',
        message:
          'authorization.whitelist is no longer supported because request Host headers are untrusted; use publicRoutes for intentional anonymous access.',
      },
    ],
  );
});

test('null authorization is rejected instead of defaulting to no authentication', () => {
  assert.throws(
    () => validateConfiguration({ db: 'app.db', authorization: null }),
    (error) => error.code === 'INVALID_CONFIGURATION' && /authorization must be an object/.test(error.message),
  );
});

test('JWT-only environment settings fail closed when the verification key is missing', () => {
  assert.throws(
    () =>
      validateConfiguration(
        configurationFromEnvironment({
          LOKI_AUTHZ_JWT_ANONYMOUS_READ: 'true',
        }),
      ),
    (error) =>
      error.code === 'INVALID_CONFIGURATION' &&
      /exactly one of sharedSecret or jwksUrl/.test(error.message),
  );
});
