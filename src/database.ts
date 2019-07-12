import loki, { Collection, LokiFsAdapter } from 'lokijs';
import { sortByDateDesc } from './utils';

const collections = {} as { [key: string]: Collection };

const databaseInitialize = () => {
  if (db.collections && db.collections.length > 0) {
    db.collections.forEach(c => {
      collections[c.name] = db.getCollection(c.name);
    });
  }
  // kick off any program logic or start listening to external events
  runProgramLogic();
};

const runProgramLogic = () => {
  Object.keys(collections)
    .map(name => collections[name])
    .map(collection => {
      console.log(`Number of entries in collection ${collection.name}: ${collection.count()}`);
    });
};

const db = new loki('rest_easy_loki.db', {
  // Since our LokiFsStructuredAdapter is partitioned, the default 'rest_easy_loki.db'
  // file will actually contain only the loki database shell and each of the collections
  // will be saved into independent 'partition' files with numeric suffix.
  adapter: new LokiFsAdapter(),
  autoload: true,
  autoloadCallback: databaseInitialize,
  autosave: true,
  autosaveInterval: 4000,
} as Partial<LokiConfigOptions>);

// Since autosave timer keeps program from exiting, we exit this program by ctrl-c.
// (optionally) For best practice, lets use the standard exit events to force a db flush to disk
//    if autosave timer has not had a fired yet (if exiting before 4 seconds).
process.on('SIGINT', () => {
  console.log('flushing database...');
  db.close();
  process.exit(0);
});

export const post = (collectionName: string, item: unknown) => {
  if (!collections.hasOwnProperty(collectionName)) {
    collections[collectionName] = db.addCollection(collectionName);
  }
  return collections[collectionName].insert(item);
};

export const dbCollections = () =>
  Object.keys(collections)
    .map(key => collections[key])
    .map(col => ({ name: col.name, entries: col.count() }));

export const del = (collectionName: string, id: number) => {
  if (!collections.hasOwnProperty(collectionName)) {
    return false;
  }
  const item = collections[collectionName].get(id);
  if (item) {
    return collections[collectionName].remove(item);
  }
  return false;
};

export const update = (collectionName: string, id: number, item: any) => {
  if (!collections.hasOwnProperty(collectionName)) {
    return false;
  }
  const it = collections[collectionName].get(id);
  return collections[collectionName].update(Object.assign(it, item));
};

export const updateItem = (collectionName: string, item: any) => {
  if (!collections.hasOwnProperty(collectionName)) {
    return false;
  }
  return collections[collectionName].update(item);
};

export const get = (collectionName: string, query: string | number | unknown) => {
  if (!collections.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collections[collectionName];
  if (typeof query === 'number') {
    return collection.get(query);
  }
};

export const all = (collectionName: string, query?: string) => {
  if (!collections.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collections[collectionName];
  const q = query
    ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
    : undefined;
  return q
    ? collection
        .chain()
        .find(q)
        .sort(sortByDateDesc)
        .data()
    : collection
        .chain()
        .sort(sortByDateDesc)
        .data();
};
