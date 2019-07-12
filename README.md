# REST-EASY-LOKI

A simple REST interface for the in-memory database, `lokijs`, featuring:

- Get an overview of all collections: [https://localhost:3000/collections](https://localhost:3000/collections).
- Get all messages in a collection: [https://localhost:3000/COLLECTION_NAME](https://localhost:3000/COLLECTION_NAME).
  - Pagination of messages in a collection: [https://localhost:3000/COLLECTION_NAME?from=0&to=10](https://localhost:3000/COLLECTION_NAME?from=0&to=10).
  - Query a collection using find, for example based on strict equality `q={"name": "a name"}`: [https://localhost:3000/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%22My%20third%20lesson%22%20%7D](https://localhost:3000/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%22My%20third%20lesson%22%20%7D)
  - Another query example, not equal `q={"name": {"$ne": "a name"}}`: [https://localhost:3000/COLLECTION_NAME?from=0&to=10&q=%7B%20%22name%22:%20%7B%20%22$ne%22:%20%22My%20third%20lesson%22%20%7D%7D](https://localhost:3000/COLLECTION_NAME?from=0&to=10&q=q=%7B%20%22name%22:%20%7B%20%22$neq%22:%20%22My%20third%20lesson%22%20%7D%7D).
- Create a new item: POST the item as an `application/json` body to [https://localhost:3000/COLLECTION_NAME](https://localhost:3000/COLLECTION_NAME).
- Get the item with `$loki` ID: [https://localhost:3000/COLLECTION_NAME/ID](https://localhost:3000/COLLECTION_NAME/1).
- Delete the item with `$loki` ID: Make a DELETE request to [https://localhost:3000/COLLECTION_NAME/ID](https://localhost:3000/COLLECTION_NAME/1).
- Update the item by ID. PUT the item as an `application/json` body to [https://localhost:3000/COLLECTION_NAME/ID](https://localhost:3000/COLLECTION_NAME/ID). Alternatively, change the original item (from the GET, so including `$loki` ID) and PUT it back to [https://localhost:3000/COLLECTION_NAME](https://localhost:3000/COLLECTION_NAME)
- Automatic creation of new collections: when you post a message to a non-existing collection, it is automatically created.

## Installation

```bash
npm install
npm start # Will transpile the TypeScript project to JavaScript and run node on every change.
```

## Usage

To simply run the `lokijs` server

```bash
npm run serve
```
