# REST-EASY-LOKI

A simple REST interface for the in-memory database, `lokijs`, featuring:

- Automatic creation of collections, including CRUD actions, pagination and MongoDB-like queries.
- Simple authorization using whitelisting domain names and API keys via environment variables.
- Statically sharing the public folder
- Retrieving environment variables starting with `LOKI_` via REST

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
    const api = createApi({ cors, sizeLimit }) as Koa;
    api.listen(port);
    console.log(`Server running on port ${port}.`);
  });
};
startService();
```

### Configuration

- Reads `.env` file for specifying the database name, port, CORS and message size limits.

### Managing collections (CRUD)

- Get an overview of all collections: [https://localhost:3000/api/collections](https://localhost:3000/api/collections).
- Get all messages in a collection: [https://localhost:3000/api/COLLECTION_NAME](https://localhost:3000/api/COLLECTION_NAME).
- Automatic creation of new collections: when you post a message to a non-existing collection, it is automatically created.
- Create a new item: POST the item as an `application/json` body to [https://localhost:3000/api/COLLECTION_NAME](https://localhost:3000/api/COLLECTION_NAME).
- Get the item with `$loki` ID: [https://localhost:3000/api/COLLECTION_NAME/ID](https://localhost:3000/api/COLLECTION_NAME/1).
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
- Another query example, not equal `q={"name": {"$ne": "a name"}}`: [https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%7B%20%22$ne%22:%20%22My%20third%20lesson%22%20%7D%7D](https://localhost:3000/api/COLLECTION_NAME?from=0&to=10&q=q=%7B%20%22name%22:%20%7B%20%22$neq%22:%20%22My%20third%20lesson%22%20%7D%7D).- You can filter the properties that get returned (simple GraphQL-like filter) using a collection's 'view', e.g. [http://localhost:3000/api/COLLECTION_NAME/view?props=title,$loki,file](http://localhost:3000/api/COLLECTION_NAME/view?props=title,$loki,file).

### Sharing the public folder

You can use the `public` folder for sharing static files or your own web application.

### Uploading files

You can use the `upload` folder for uploading files to a (automatically created) CONTEXT folder, if enabled on start-up using the `-u` instruction. Test it via `curl -F "file=@filename.jpg" http://localhost:3030/upload/:CONTEXT`. Files will be served from `http://localhost:3030/:CONTEXT/ORG_FILENAME`. When uploading the same filename in the same context, the previous version will be overwritten. No index file is created, so the contents of the locally created folders are not visible externally. Also note that the CONTEXT supports sub-folders too.

### Socket.io support

If enabled using the `io` flag (or -i) so clients can subscribe to receive updates when a value has changed. Clients can either subscribe to a collection `socket.subscribe('COLLECTION_NAME')`, or to a collection item `socket.subscribe('COLLECTION_NAME/$LOKI')`. The latter is, for example, useful when you have multiple editors. Subscribers receive the updated item.

### Serving environment variables

The [http://localhost:3000/api/env](http://localhost:3000/api/env) serves all environment variables that start with `LOKI_` (except the `LOKI_AUTHZ_`, so you don't accidentally share secrets). Since all key-value pairs are strings, a type conversion to boolean, number and arrays (using the , as separator) is performed.

### Authorization

- Simple authorization can be enabled by specifying environment variables: `LOKI_AUTHZ_CREATE`, `LOKI_AUTHZ_READ`, `LOKI_AUTHZ_UPDATE`, `LOKI_AUTHZ_DELETE`, where the value is a comma-separated list of API keys. If no `authz` is set, all CRUD actions are allowed. Otherwise, your query needs to set the `x-api-key` header.
- You can require it in your own project.
