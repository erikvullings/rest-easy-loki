# Migrating from 1.x to 2.0

Version 2.0 introduces explicit application and database lifecycles, validated
authorization configuration, deterministic persistence, and centralized
collection semantics. It also removes behavior that depended on process-global
state or untrusted HTTP headers.

## Before upgrading

1. Pin `rest-easy-loki` to `2.0.0-rc.1` while testing. Do not widen an existing
   1.x range until the migration is complete.
2. Back up the Loki database shell and its numeric structured partitions, such
   as `app.db`, `app.db.0`, and `app.db.1`.
3. Review every `LOKI_AUTHZ_*` setting. Version 2 fails startup on ambiguous or
   incomplete authorization instead of silently disabling it.
4. Exercise startup/import, list and view queries, create, replace, patch, and
   delete against a copy of the database.

## CLI applications

The executable remains `rest-easy-loki`, and direct execution of
`rest-easy-loki/dist/cli.js` remains available. The CLI now owns `.env` loading,
configuration validation, signal handling, startup, and shutdown, so an
external `-r dotenv/config` preload is no longer required.

```json
{
  "scripts": {
    "start": "rest-easy-loki --config ./config.json --upload uploads"
  }
}
```

Configuration is validated before database files or listeners are created.
Invalid booleans, ports, authorization combinations, policy files, and import
files now fail startup with an actionable error.

### Hostname whitelists

`LOKI_AUTHZ_WHITELIST` is no longer supported. The old check trusted the HTTP
`Host` header, which a client can choose, so it was not an authentication
boundary.

Choose one explicit replacement:

- **Intentionally open service:** remove every `LOKI_AUTHZ_*` variable. This
  selects authorization mode `none`. Only use this on a trusted network or
  behind an authenticating reverse proxy.
- **API keys:** remove `LOKI_AUTHZ_WHITELIST`, retain the action-specific key
  variables, and send `x-api-key` from trusted server-side clients. Do not put a
  shared API key in public browser code.
- **JWT:** configure exactly one of `LOKI_AUTHZ_JWT_SHARED` or
  `LOKI_AUTHZ_JWT_JWKS`, plus route policies. For embedded applications,
  `publicRoutes` can expose narrowly defined anonymous endpoints.

For example, a project-board-style application that was effectively open
because its browser relied on `LOKI_AUTHZ_WHITELIST=localhost` should either
remove all of these settings:

```bash
LOKI_AUTHZ_CREATE
LOKI_AUTHZ_READ
LOKI_AUTHZ_UPDATE
LOKI_AUTHZ_DELETE
LOKI_AUTHZ_WHITELIST
```

or add real server-side authentication before upgrading. Removing only the
whitelist while keeping write keys configured will make unauthenticated
`POST`, `PUT`, `PATCH`, and `DELETE` requests return `401`.

## Embedded applications

Use the application lifecycle when the host process owns the server:

```ts
import { createApplication } from 'rest-easy-loki';

const application = createApplication({
  configuration: {
    db: './data/app.db',
    port: 3000,
    authorization: { mode: 'none' }
  },
  database: {
    collections: {
      users: { unique: ['id'] }
    }
  }
});

await application.start();
await application.ready();

// On process or test shutdown:
await application.shutdown();
```

`startService(configuration)` now returns
`Promise<ApplicationLifecycle>`. Await it if the compatibility helper is used:

```ts
const application = await startService(configuration);
await application.shutdown();
```

The callback form of `db.startDatabase(file, callback, options)` still works,
but the returned promise should be awaited so failures are observable:

```ts
await db.startDatabase('./data/app.db', undefined, databaseOptions);
```

Importing the package no longer loads `.env`, starts a listener, creates files,
or installs signal handlers.

## Configuration and environment APIs

- `config` now exports behavior-safe defaults; it is no longer populated from
  `process.env` during import.
- Use `configurationFromEnvironment(source)` at an environment adapter
  boundary.
- `environment(source)` now requires the source object instead of reading
  `process.env`.
- Authorization must explicitly use `none`, `apiKey`, or `jwt`. `null`,
  conflicting modes, incomplete JWT keys, and obsolete hostname whitelists are
  rejected.
- Authorization secrets are excluded from the public `/api/env` response.

## Collection behavior

- Queries apply filtering, ordering, pagination, and projection in that order.
- `from` and `to` are non-negative, zero-based, inclusive bounds.
- `/api/:collection/view` still invokes a configured resolver when a valid
  query returns no local records.
- `PUT` is replacement: omitted domain fields are removed.
- `PATCH` preserves omitted fields and rejects changes to `$loki`, `meta`, or a
  route identity.
- Concurrent acknowledged mutations are serialized with persistence and remain
  present after restart.
- Bulk mutations are intentionally partial: successful earlier operations are
  persisted if a later operation fails.
- JSON query filters accept the operators documented in `README.md`.
  Function-valued and regular-expression operators such as `$regex` are not
  accepted over JSON; use a supported string operator or a dedicated resolver.

## Project-board checklist

For applications with the same integration pattern as project-board:

1. Change the dependency from `^1.6.4` to exactly `2.0.0-rc.1`.
2. Remove `LOKI_AUTHZ_WHITELIST`.
3. Either remove the remaining `LOKI_AUTHZ_*` settings to preserve the current
   open behavior, or implement authentication and attach credentials to write
   requests.
4. Keep `--config ./config.json`; configured collections and JSON imports remain
   supported and now complete before readiness.
5. Verify `$in` and equality queries, `view?props=...`, and numeric Loki-ID CRUD.
6. Refresh the lockfile only after the smoke test passes.

