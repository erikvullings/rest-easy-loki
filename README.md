# REST-EASY-LOKI

A simple REST interface for the in-memory database, [lokijs](https://techfort.github.io/LokiJS/), featuring:

> Upgrading from 1.x? Follow the [2.0 migration guide](MIGRATION.md), especially
> the authorization changes, before updating downstream applications.

- Automatic creation of collections, including CRUD actions, pagination and MongoDB-like queries.
- Explicit no-auth, API-key, or JWT authorization with configurable public routes.
- Statically sharing the public folder
- Uploading files using the upload folder
- Retrieving environment variables starting with `LOKI_` via REST
- Configuring the database collections using a config file
- Add support for CORS and compression

This version has moved from the default `LokiFsAdapter` to the more performing `LokiFsStructuredAdapter`. Besides a [performance gain](https://github.com/techfort/LokiJS/wiki/LokiJS-persistence-and-adapters#an-example-using-fastest-and-most-scalable-lokifsstructuredadapter-for-nodejs-might-look-like-), it also means that we don't end up with a single database file anymore, but one overall database file and one per collection.

## Development

```bash
pnpm install
pnpm start # Will transpile the TypeScript project to JavaScript and run node on every change.
```

## Usage

To simply run the `lokijs` server and expose the CRUD services.

```bash
npm run serve
```

To embed it in your own project, do something like the following:

```ts
import { createApplication } from 'rest-easy-loki';

const application = createApplication({
  configuration: {
    db: './data/app.db',
    port: 0, // Use an ephemeral port in tests.
    cors: true,
    sizeLimit: '25mb',
    compression: true,
    upload: 'upload',
    public: 'public'
  },
  database: {
    collections: {
      documents: { unique: ['id'] }
    }
  }
});

await application.start();
await application.ready();
console.log(`Server running on port ${application.port}.`);

await application.shutdown();
```

`createApplication` is the shared lifecycle used by embedding applications and the CLI. It assembles middleware, optional caller routes, collection access, database startup, Socket.IO, and the HTTP listener in that order. `start()`, `ready()`, and `shutdown()` are awaitable. Repeated calls are idempotent; calling `start()` after shutdown starts the application again. A partially failed startup closes any listener and database it opened.

Importing the package does not read files, start listeners, or install process signal handlers. Signal handling and `.env` loading belong to the CLI adapter. The existing `startService(configuration)` helper remains available and now resolves to the started application lifecycle, allowing callers to await and later shut it down.

### Database lifecycle

Database startup is awaitable. It reports ready only after the database is loaded, configured collections are created, JSON imports are inserted, and the initial state is persisted. Startup rejects with collection and filename context when loading, parsing, importing, or persistence fails.

```ts
import { createDatabaseLifecycle } from 'rest-easy-loki';

const database = createDatabaseLifecycle({
  file: './data/app.db',
  collections: {
    users: {
      unique: ['id'],
      jsonImport: './users.json'
    }
  }
});

await database.start();
await database.ready();
console.log(database.collections());

await database.shutdown(); // Persists pending changes before closing.
```

Configured collections that already exist are loaded without repeating their original import. Newly configured collections are added to an existing database and imported before readiness. Set `rebuild: true` before the first `start()`, or call `rebuild()` later, to delete the database shell and its structured collection partitions before recreating configured data.

The callback form of `db.startDatabase(file, callback, options)` remains supported, but the returned promise should be awaited so startup failures can be handled. Use `db.shutdownDatabase()` for deterministic final persistence.

### Configuration

Application configuration is validated once before the database or listener starts. Embedding applications pass configuration explicitly to `createApplication`; importing lower-level Modules never reads `process.env`. The CLI is the environment adapter and continues to load `.env` plus the following variables:

```bash
LOKI_PORT=3030
LOKI_DB="simple.db"
LOKI_CORS=true
LOKI_COMPRESSION=true
LOKI_CONFIG="config.json"
LOKI_POLICIES="policies.json"
LOKI_SIZE_LIMIT="250mb"
LOKI_PRETTY=true
LOKI_DEBUG=false
LOKI_AUTHZ_JWT_SHARED=""
LOKI_AUTHZ_JWT_JWKS=""
LOKI_AUTHZ_READ=""
LOKI_AUTHZ_CREATE="key1"
LOKI_AUTHZ_UPDATE="key1"
LOKI_AUTHZ_DELETE="key1"
```

Boolean environment values must be `true` or `false`, and `LOKI_PORT` must be an integer. JWT shared-secret, JWT JWKS, and API-key settings are mutually exclusive; conflicting or incomplete settings fail startup with `INVALID_CONFIGURATION`.

`LOKI_AUTHZ_WHITELIST` hostname bypasses are no longer supported because HTTP `Host` headers are client-controlled. Replace them with explicit `publicRoutes` rules for intentionally anonymous endpoints.

Tests and other adapters can create configuration without global state:

```ts
import { configurationFromEnvironment, validateConfiguration } from 'rest-easy-loki';

const fromEnvironment = configurationFromEnvironment({
  LOKI_DB: './data/test.db',
  LOKI_PORT: '0',
  LOKI_CORS: 'false'
});
const configuration = validateConfiguration(fromEnvironment);
```

When creating the database for the first time, you optionally can also configure the database collections using LokiJS options, e.g. by specifying unique property names, or properties that must be indexed. In addition, you can import any existing JSON file in one go. For example, see `config.json` below: with it, you create two collections, `users` and `projects`, and each collection has a unique property `id` and several indices. In addition, it imports the file specified by `jsonImport`.

```json
{
  "collections": {
    "users": {
      "jsonImport": "./employees.json",
      "unique": ["id"],
      "indices": ["first", "last", "keywords", "summary"]
    },
    "projects": {
      "jsonImport": "./projects.json",
      "unique": ["id"],
      "indices": ["name", "keywords", "summary"]
    }
  }
}
```

The configuration file needs to adhere to the `ILokiConfiguration` interface, as specified below:

```ts
/** From LokiJS typings, but not exported */
export interface CollectionOptions<E> {
  disableMeta: boolean;
  disableChangesApi: boolean;
  disableDeltaChangesApi: boolean;
  adaptiveBinaryIndices: boolean;
  asyncListeners: boolean;
  autoupdate: boolean;
  clone: boolean;
  cloneMethod: 'parse-stringify' | 'jquery-extend-deep' | 'shallow' | 'shallow-assign' | 'shallow-recurse-objects';
  serializableIndices: boolean;
  transactional: boolean;
  ttl: number;
  ttlInterval: number;
  exact: (keyof E)[];
  unique: (keyof E)[];
  indices: keyof E | (keyof E)[];
}

export type ExtendedCollectionOptions<E> = Partial<CollectionOptions<E>> & {
  /** JSON file to import: expects a JSON array which will be inserted into the collection */
  jsonImport?: string;
};

export interface ILokiConfiguration<T = {}> {
  /** Create collections on startup if there are no collections yet */
  collections?: {
    /** Name of the collection */
    [collectionName: string]: ExtendedCollectionOptions<T>;
  };
}
```

If you do specify one or more unique names, you can query the REST interface via [https://localhost:3000/api/COLLECTION_NAME/USERS/THOR](https://localhost:3000/api/COLLECTION_NAME/USERS/THOR).

### Managing collections (CRUD)

- Get an overview of all collections: [https://localhost:3000/api/collections](https://localhost:3000/api/collections).
- Get all messages in a collection: [https://localhost:3000/api/COLLECTION_NAME](https://localhost:3000/api/COLLECTION_NAME).
- Automatic creation of new collections: when you post a message to a non-existing collection, it is automatically created.
- Create a new item: POST the item as an `application/json` body to [https://localhost:3000/api/COLLECTION_NAME](https://localhost:3000/api/COLLECTION_NAME).
- Get the item with `$loki` ID: [https://localhost:3000/api/COLLECTION_NAME/ID](https://localhost:3000/api/COLLECTION_NAME/1).
- Get the item by unique name `UNIQUE_NAME`: [https://localhost:3000/api/COLLECTION_NAME/UNIQUE_PROP_NAME/PROP_VALUE](https://localhost:3000/api/COLLECTION_NAME/USERS/THOR).
- Delete the item with `$loki` ID: Make a DELETE request to [https://localhost:3000/api/COLLECTION_NAME/ID](https://localhost:3000/api/COLLECTION_NAME/1).
- Update the item by ID. PUT the item as an `application/json` body to [https://localhost:3000/api/COLLECTION_NAME/ID](https://localhost:3000/api/COLLECTION_NAME/ID). Alternatively, change the original item (from the GET, so including `$loki` ID) and PUT it back to [https://localhost:3000/api/COLLECTION_NAME](https://localhost:3000/api/COLLECTION_NAME)
- Patch the item by ID, where the patch is based on [RFC6902](https://www.npmjs.com/package/rfc6902). PATCH item is an `application/json` body to [https://localhost:3000/api/COLLECTION_NAME/ID](https://localhost:3000/api/COLLECTION_NAME/ID). The send patch object is defined as specified below. In case `saveChanges` is specified, the patch is also saved to the appropriate collection (after removing the `saveChanges` property).

```ts
export interface IMutation extends ILokiObj {
  /**
   * Save changes to collection: if set, save this object,
   * except the `saveChanges` property, to the `saveChanges` collection
   */
  saveChanges?: string;
  /** RFC6902 JSON patch */
  patch?: Operation[];
}
```

For programmatic access, use the same collection Module as the HTTP adapter:

```ts
import { createCollectionAccess, createDatabaseLifecycle } from 'rest-easy-loki';

const database = createDatabaseLifecycle({
  file: './data/app.db',
  collections: { users: { unique: ['id'] } }
});
await database.start();
const users = createCollectionAccess(database);

await users.create('users', { id: 'alice', name: 'Alice', role: 'reader' });
await users.get('users', { id: 'alice' }); // No $loki identity is required.
await users.replace('users', { id: 'alice' }, { name: 'Alicia' }); // Removes role.
await users.patch('users', { id: 'alice' }, [
  { op: 'add', path: '/role', value: 'admin' }
]);
await users.delete('users', { id: 'alice' });
```

`replace` replaces all domain fields omitted from the body while retaining managed metadata and the route identity. `patch` applies RFC 6902 operations to the existing record and preserves omitted fields. Managed `$loki`, `meta`, and the unique field used as route identity cannot be changed.

All mutations are persisted before their promises resolve. `bulk(collection, operations)` accepts `create`, `replace`, `patch`, and `delete` operations. Bulk execution is intentionally **not atomic**: operations run in order, stop at the first failure, persist preceding successes, and reject with `BULK_FAILED` and the number of applied operations.

Collection errors expose a stable `code`, HTTP `status`, and message. The HTTP adapter returns them as:

```json
{
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "Record was not found in collection 'users'."
  }
}
```

Validation codes include `INVALID_COLLECTION`, `COLLECTION_NOT_FOUND`, `INVALID_FILTER`, `INVALID_PROJECTION`, `INVALID_PAGINATION`, `INVALID_ORDERING`, `INVALID_RECORD`, `INVALID_IDENTITY`, `IDENTITY_CONFLICT`, `RECORD_NOT_FOUND`, `INVALID_PATCH`, and `BULK_FAILED`.

### Filtering collections

- `q` is one URL-encoded JSON object. Supported operators are `$eq`, `$aeq`, `$ne`, `$dteq`, `$gt`, `$gte`, `$lt`, `$lte`, `$jgt`, `$jgte`, `$jlt`, `$jlte`, `$between`, `$jbetween`, `$in`, `$nin`, `$keyin`, `$nkeyin`, `$definedin`, `$undefinedin`, `$containsString`, `$containsNone`, `$containsAny`, `$contains`, `$elemMatch`, `$type`, `$finite`, `$size`, `$len`, `$not`, `$and`, `$or`, and `$exists`. Function-valued and regular-expression operators are not accepted over JSON.
- `from` and `to` are non-negative, zero-based, inclusive pagination bounds. For example, `?from=0&to=9` returns at most ten records.
- `sort` is a comma-separated property list. `order` is the matching comma-separated `asc` or `desc` list, for example `?sort=last,name&order=asc,desc`.
- `props` on `/api/COLLECTION_NAME/view` is a comma-separated projection of top-level properties. Filtering, ordering, pagination, and projection are applied in that order.
- Strict equality example: `q={"name":"Alice"}`.
- Operator example: `q={"age":{"$gte":18}}`.

### Sharing the public folder

You can use the `public` folder for sharing static files or your own web application. Enabled by default.

### Uploading files

You can use the `upload` folder for uploading files to a (automatically created) CONTEXT folder, if enabled on start-up using the `-u` instruction. Test it via `curl -F "file=@filename.jpg" http://localhost:3030/upload/:CONTEXT`. Files will be served from `http://localhost:3030/:CONTEXT/ORG_FILENAME`. When uploading the same filename in the same context, the previous version will be overwritten. No index file is created, so the contents of the locally created folders are not visible externally. Also note that the CONTEXT supports sub-folders too.

### Socket.io support

If enabled using the `io` flag (or -i) so clients can subscribe to receive updates when a value has changed. Clients can either subscribe to a collection `socket.subscribe('COLLECTION_NAME')`, or to a collection item `socket.subscribe('COLLECTION_NAME/$LOKI')`. The latter is, for example, useful when you have multiple editors. Subscribers receive the updated item.

### Serving environment variables

The [http://localhost:3000/api/env](http://localhost:3000/api/env) route serves the explicit `configuration.environment` object. The CLI populates it from variables starting with `LOKI_`, excluding all `LOKI_AUTHZ_` secrets, and converts booleans, numbers, and comma-separated arrays. Embedding applications expose nothing unless they supply this object.

### Authorization

- Authorization has three explicit modes: `none`, `apiKey`, and `jwt`.
- `none` allows every request.
<!--
- JWT shared-key authorization can be enabled by specifying environment variable: `LOKI_AUTHZ_JWT_SHARED`. This disables the other `LOKI_AUTHZ_` methods. The JWT token has to be generated by the same shared key as used here. For testing purposes, you can create [JWT tokens online](http://jwtbuilder.jamiekurtz.com/). JWT tokens should be given via the `Authorization` header as a `Bearer` token, i.e. `Authorization: Bearer <YOUR_JWT>`. Set `LOKI_AUTHZ_JWT_ANONYMOUS_READ` to `true` to allow anonymous reads.
-->
- `apiKey` maps `GET`, `POST`, `PUT/PATCH`, and `DELETE` to read, create, update, and delete key lists. An action with no configured keys remains public for CLI compatibility. A configured `publicRoutes` rule can bypass key checks for an intentionally anonymous endpoint.
- `jwt` accepts exactly one `sharedSecret` or `jwksUrl`, then evaluates the verified payload against route policy rules. `anonymousRead` makes all `GET` routes public; `publicRoutes` can expose narrower method/path patterns.

```ts
const application = createApplication({
  configuration: {
    db: './data/app.db',
    port: 3000,
    authorization: {
      mode: 'apiKey',
      keys: {
        read: ['reader-key'],
        create: ['writer-key'],
        update: ['writer-key'],
        delete: ['admin-key']
      },
      publicRoutes: [{ method: 'GET', path: '/api/env' }]
    }
  }
});
```

Missing credentials return `401` with `AUTHENTICATION_REQUIRED`; malformed JWTs return `401` with `INVALID_CREDENTIALS`; authenticated or API-key requests without permission return `403` with `ACCESS_FORBIDDEN`. All use the same JSON shape:

```json
{
  "error": {
    "code": "ACCESS_FORBIDDEN",
    "message": "The authenticated subject is not authorized for this route."
  }
}
```

### Route Based Access Control

JWT authorization uses route-based access control. Programmatic callers provide `authorization.rules`; the CLI can set `LOKI_POLICIES` to a JSON file with the following structure (as specified in the `rule-policy-schema.json` file). Missing, malformed, or empty required policies fail before database startup:

```json
{
  "$schema": "./rule-policy-schema.json",
  "rules": [
    {
      "method": "GET",
      "path": "/api/users/:sub"
    },
    {
      "method": "GET",
      "path": "/api/users/*",
      "abac": {
        "roles": "admin"
      }
    },
    {
      "method": "GET",
      "path": "/api/cases",
      "abac": {
        "roles": "admin"
      }
    },
    {
      "method": "POST",
      "path": "/api/users",
      "abac": {
        "roles": "admin"
      }
    },
    {
      "method": "GET",
      "path": "/api/cases",
      "query": {
        "q": "{ 'members': { '$contains': ':sub' } }"
      }
    }
  ]
}
```
### Explanation

Currently, there are two main open source libraries for access control, both used by Amazon Web Services and others: [Open Policy Agent](https://www.openpolicyagent.org/) (OPA) and [Cedar](https://github.com/permitio/cedar-agent). See the comparison [here](https://www.styra.com/knowledge-center/opa-vs-cedar-aws-verified-permissions/). Although the former is more general, and also used to control access to all kinds of micro-services, it has a steeper learning curve. Cedar is more to the point, and focusses on Role-based Access Control (RBAC) or Attribute-based Access Control (ABAC) with a subject, action and resource. However, both suffer from one major drawback, namely using attributes from the resource to determine access. 

Consider the following example: you allow a user to create case files. In each case file, the user specifies other users that have access too. Let's assume the database holds a collection of case files (rows or objects in my database), and each case contains a `members` array with the user IDs of the users that have access. When users queries the server for their case files, the authorization function (the Policy Decision Point or PEP) would need to know the attributes of each case file to determine whether that user has access, i.e. is the user's ID part of the case file's `members` property. However, this would mean that the server first needs to query the database to get access to all case files, potentially thousands, and next the authorization service would need to verify each of them. Clearly, this does not scale, so the common solution is called [partial evaluation](https://blog.openpolicyagent.org/partial-evaluation-162750eaf422), where the authorization service only verifies the attributes of the subject and the action, but skips the verification of the resource attributes. In case access is partially granted, the resource attributes that are not are converted to a SQL or other database query, which is subsequently executed. As the latter step is not trivial, and open to security issues, this repository has chosen a different approach which is coined Route-based Access Control (RouBAC).

How does RouBAC work: you create a policy file, a JSON object that contains a list of rules (see the example below). Each rule is evaluated until a rule allows access, or all rules are processed, in which case access is denied. 

How does the rule evaluation work:

- By default, access is denied, unless a rule allows it.
- Each rule is checked against the method, path, and query parameters. If there is a match, the query is allowed and no other rules are checked.
- A rule matches if:
  - The method and path match.
  - The rule's path placeholders, like `:sub`, are present in the user's JWT payload, e.g. the first rule only allows access to `/users/123` if the payload contains a property `sub` whose value is 123 (using strict checking).
  - If present, the canonical form (no spaces, single quotes, escaped $, but still case-sensitive) of the query parameters are matched against the rule's query parameters. They may contain placeholders too. Additional query properties are ignored.
  - The rule's `abac` object, if present, is checked against the user's JWT payload, so the second rule only allows access to `GET /users` if the payload contains a property `roles` whose value is `admin`. In case `roles` is an array, access is permitted only if the rule's role is a subset of the user's roles. Note that the role only allows a single string, so if the `editor` role has access too, a new rule is needed.
  - Support for nested properties is added too, so `realm_access.roles` would also work.

You can use [Bruno](https://www.usebruno.com) to test a few policies that are found in the `test-rest-easy-loki` folder.

#### Usage notes regarding policies, authn/authz, and syntax

A general 401 error will be thrown if the ```Authorization``` header is missing or malformed, and when a token is expired or incorrectly signed. 
In other words, `rest-easy-loki` will not tell you what is wrong exactly.
In a similar vein, no feedback is given about the specific reason why a request does not match any policy rule.
This means that you should critically review your requests and policy file for formatting, especially regarding the use of whitespace, quotation marks, and regex.
Also, make sure that any used JWT properties are present and correct if you use placeholders.

For example, the following GET request:

```
https://example.org/api/reports?q={%22case%22:%2242%22,%22editor%22:%22someuser@somedomain.org%22,%20%22allowed%22:%20{%20%22$contains%22:%20%22someotheruser@somedomain.org%22}}
```

would satisfy the below policy rule (if the signed JWT contains a property ```email``` with value ```someotheruser@somedomain.org```):

```json
    {
      "method": "GET",
      "path": "/api/reports",
      "query": {
        "q": "{ 'case': '\\w+', 'editor': '.+', 'allowed': { '$contains': ':email' } }"
      }
    },
```

The ```LOKI_DEBUG``` environment variable can help you debug your requests and policies.
