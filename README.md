# REST-EASY-LOKI

A simple REST interface for the in-memory database, `lokijs`, featuring:

- Automatic creation of collections, including CRUD actions, pagination and MongoDB-like queries.
- Simple authorization using whitelisting domain names and API keys via environment variables.
- Statically sharing the public folder
- Uploading files using the upload folder
- Retrieving environment variables starting with `LOKI_` via REST
- Configuring the database collections using a config file
- Add support for CORS and compression

This version has moved from the default `LokiFsAdapter` to the more performing `LokiFsStructuredAdapter`. Besides a [performance gain](https://github.com/techfort/LokiJS/wiki/LokiJS-persistence-and-adapters#an-example-using-fastest-and-most-scalable-lokifsstructuredadapter-for-nodejs-might-look-like-), it also means that we don't end up with a single database file anymore, but one overall database file and one per collection.

## Development

```bash
npm install # Or pnpm i
npm start # Will transpile the TypeScript project to JavaScript and run node on every change.
```

## Usage

To simply run the `lokijs` server and expose the CRUD services.

```bash
npm run serve
```

To embed it in your own project, do something like the following:

```ts
import * as Koa from 'koa'; // You only need to include @types/koa in your devDependencies, not Koa itself.
import { createApi, db } from 'rest-easy-loki';

export const collectionName = 'documents';

const port = process.env.LOKI_PORT || '3000';
const dbName = process.env.LOKI_DB;
const cors = (process.env.LOKI_CORS || 'true') === 'true';
const sizeLimit = process.env.LOKI_SIZE_LIMIT || '25mb';

export const startService = () => {
  db.startDatabase(dbName, () => {
    const { api } = createApi({
      cors,
      sizeLimit,
      compression: true, // Compress data using gzip
      upload: 'upload',  // Allow uploading data to this folder
      public: 'public'   // Serve all files in this folder, e.g. SPA
    }) as Koa;
    api.listen(port);
    console.log(`Server running on port ${port}.`);
  });
};
startService();
```

### Configuration

Reads `.env` file for specifying the database name, port, CORS and message size limits. E.g.

```bash
LOKI_PORT=3030
LOKI_DB="simple.db"
LOKI_CORS=true
LOKI_COMPRESSION=true
LOKI_CONFIG="config.json"
LOKI_POLICIES="policies.json"
LOKI_SIZE_LIMIT="250mb"
LOKI_PRETTY=true
LOKI_AUTHZ_JWT_SHARED=""
LOKI_AUTHZ_JWT_JWKS=""
LOKI_AUTHZ_READ=""
LOKI_AUTHZ_CREATE="key1"
LOKI_AUTHZ_UPDATE="key1"
LOKI_AUTHZ_DELETE="key1"
LOKI_AUTHZ_WHITELIST="localhost"
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

export interface ExtendedCollectionOptions<E> extends CollectionOptions<E> {
  /** JSON file to import: expects a JSON array which will be inserted into the collection */
  jsonImport?: string;
}

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

### Filtering collections

- Pagination of messages in a collection: [https://localhost:3000/api/COLLECTION_NAME?from=0&to=10](https://localhost:3000/api/COLLECTION_NAME?from=0&to=10).
- Query a collection using find, for example based on strict equality `q={"name": "a name"}`: [https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%22My%20third%20lesson%22%20%7D](https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%22My%20third%20lesson%22%20%7D)
- Another query example, not equal `q={"name": {"$ne": "a name"}}`: [https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%7B%20%22$ne%22:%20%22My%20third%20lesson%22%20%7D%7D](https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=q=%7B%20%22name%22:%20%7B%20%22$neq%22:%20%22My%20third%20lesson%22%20%7D%7D).
- You can filter the properties that get returned (simple GraphQL-like filter) using a collection's 'view', e.g. [http://localhost:3000/api/COLLECTION_NAME/view?props=title,$loki,file](http://localhost:3000/api/COLLECTION_NAME/view?props=title,$loki,file).

### Sharing the public folder

You can use the `public` folder for sharing static files or your own web application. Enabled by default.

### Uploading files

You can use the `upload` folder for uploading files to a (automatically created) CONTEXT folder, if enabled on start-up using the `-u` instruction. Test it via `curl -F "file=@filename.jpg" http://localhost:3030/upload/:CONTEXT`. Files will be served from `http://localhost:3030/:CONTEXT/ORG_FILENAME`. When uploading the same filename in the same context, the previous version will be overwritten. No index file is created, so the contents of the locally created folders are not visible externally. Also note that the CONTEXT supports sub-folders too.

### Socket.io support

If enabled using the `io` flag (or -i) so clients can subscribe to receive updates when a value has changed. Clients can either subscribe to a collection `socket.subscribe('COLLECTION_NAME')`, or to a collection item `socket.subscribe('COLLECTION_NAME/$LOKI')`. The latter is, for example, useful when you have multiple editors. Subscribers receive the updated item.

### Serving environment variables

The [http://localhost:3000/api/env](http://localhost:3000/api/env) serves all environment variables that start with `LOKI_` (except the `LOKI_AUTHZ_`, so you don't accidentally share secrets). Since all key-value pairs are strings, a type conversion to boolean, number and arrays (using the , as separator) is performed.

### Authorization

- Simple authorization can be enabled by specifying environment variables: `LOKI_AUTHZ_CREATE`, `LOKI_AUTHZ_READ`, `LOKI_AUTHZ_UPDATE`, `LOKI_AUTHZ_DELETE`, where the value is a comma-separated list of API keys. If no `authz` is set, all CRUD actions are allowed. Otherwise, your query needs to set the `x-api-key` header.
- JWT shared-key authorization can be enabled by specifying environment variable: `LOKI_AUTHZ_JWT_SHARED`. This disables the other `LOKI_AUTHZ_` methods. The JWT token has to be generated by the same shared key as used here. For testing purposes, you can create [JWT tokens online](http://jwtbuilder.jamiekurtz.com/). JWT tokens should be given via the `Authorization` header as a `Bearer` token, i.e. `Authorization: Bearer <YOUR_JWT>`. Set `LOKI_AUTHZ_JWT_ANONYMOUS_READ` to `true` to allow anonymous reads.
- JWT JWKS authorization can be enabled by specifying environment variable: `LOKI_AUTHZ_JWT_JWKS`. This disables the other `LOKI_AUTHZ_` methods. The JWT token is generated as part of an OIDC flow. JWT tokens should be given via the `Authorization` header as a `Bearer` token. Set `LOKI_AUTHZ_JWT_ANONYMOUS_READ` to `true` to allow anonymous reads.
- You can require it in your own project.

For both JWT methods, the JWT should contain `realm_access.roles` key with a list of roles.
If the `editor` role is in there, access is granted to write to the database.

### Route Based Access Control

When using JWT or JWKS authorization, you can specify route based access control. In that case, the `LOKI_POLICIES` should be set to a JSON file with the following structure (as specified in the `rule-policy-schema.json` file):

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

Creating policies is simple:

- By default, access is denied, unless a rule allows it.
- Each rule is checked against the method, path, and query parameters. If there is a match, the query is allowed and no other rules are checked.
- A rule matches if:
  - The rule's placeholders, like `:sub`, are present in the user's JWT payload, e.g. the first rule only allows access to `/users/123` if the payload contains a property `sub` whose value is 123 (using strict checking).
  - If present, the canonical form (no spaces, single quotes, escaped $, but still case-sensitive) of the query parameters are matched against the rule's query parameters.
  - The rule's `abac` object, if present, is checked against the user's JWT payload, so the second rule only allows access to `GET /users` if the payload contains a property `roles` whose value is `admin`. In case `roles` is an array, the rule is allowed if the rule's role is a subset of the user's roles. Note that the role only allows a single string, so if the `editor` role has access too, a new rule is needed.
  - Support for nested properties is added too, so `realm_access.roles` would also work.

You can use [Bruno](https://www.usebruno.com) to test a few policies that are found in the `test-rest-easy-loki` folder.
