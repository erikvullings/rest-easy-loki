const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApplication } = require('../dist');

const withApplication = async (authorization, run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rest-easy-loki-auth-'));
  const application = createApplication({
    configuration: {
      db: path.join(directory, 'database.db'),
      port: 0,
      public: undefined,
      pretty: true,
      authorization,
    },
    host: '127.0.0.1',
  });
  try {
    await application.start();
    await run(`http://127.0.0.1:${application.port}`);
  } finally {
    await application.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
};

test('API-key mode distinguishes missing, invalid, valid, and public requests', async () => {
  await withApplication(
    {
      mode: 'apiKey',
      keys: { read: ['READ-KEY'] },
      publicRoutes: [{ method: 'GET', path: '/api/env' }],
    },
    async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/collections`);
      const invalid = await fetch(`${baseUrl}/api/collections`, { headers: { 'x-api-key': 'wrong' } });
      const spoofedHost = await fetch(`${baseUrl}/api/collections`, { headers: { host: 'trusted.example' } });
      const valid = await fetch(`${baseUrl}/api/collections`, { headers: { 'x-api-key': 'read-key' } });
      const publicRoute = await fetch(`${baseUrl}/api/env`);

      assert.deepEqual(
        {
          missing: { status: missing.status, code: (await missing.json()).error.code },
          invalid: { status: invalid.status, code: (await invalid.json()).error.code },
          spoofedHost: { status: spoofedHost.status, code: (await spoofedHost.json()).error.code },
          valid: valid.status,
          public: publicRoute.status,
        },
        {
          missing: { status: 401, code: 'AUTHENTICATION_REQUIRED' },
          invalid: { status: 403, code: 'ACCESS_FORBIDDEN' },
          spoofedHost: { status: 401, code: 'AUTHENTICATION_REQUIRED' },
          valid: 201,
          public: 200,
        },
      );
    },
  );
});

test('JWT mode distinguishes malformed credentials from insufficient authorization', async () => {
  const secret = 'a sufficiently long test secret';
  const { SignJWT } = await import('jose');
  const viewer = await new SignJWT({ roles: ['viewer'] })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
  const admin = await new SignJWT({ roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));

  await withApplication(
    {
      mode: 'jwt',
      sharedSecret: secret,
      rules: [{ method: 'GET', path: '/api/collections', abac: { roles: 'admin' } }],
    },
    async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/collections`);
      const malformed = await fetch(`${baseUrl}/api/collections`, {
        headers: { authorization: 'Bearer invalid' },
      });
      const forbidden = await fetch(`${baseUrl}/api/collections`, {
        headers: { authorization: `Bearer ${viewer}` },
      });
      const allowed = await fetch(`${baseUrl}/api/collections`, {
        headers: { authorization: `Bearer ${admin}` },
      });

      assert.deepEqual(
        {
          missing: { status: missing.status, code: (await missing.json()).error.code },
          malformed: { status: malformed.status, code: (await malformed.json()).error.code },
          forbidden: { status: forbidden.status, code: (await forbidden.json()).error.code },
          allowed: allowed.status,
        },
        {
          missing: { status: 401, code: 'AUTHENTICATION_REQUIRED' },
          malformed: { status: 401, code: 'INVALID_CREDENTIALS' },
          forbidden: { status: 403, code: 'ACCESS_FORBIDDEN' },
          allowed: 201,
        },
      );
    },
  );
});
