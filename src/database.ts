import loki, { Collection, LokiFsAdapter } from 'lokijs';
import { sortByDateDesc } from './utils';

let db: loki;

const collectionStore = {} as { [key: string]: Collection };

const databaseInitialize = () => {
  if (db.collections && db.collections.length > 0) {
    db.collections.forEach(c => {
      collectionStore[c.name] = db.getCollection(c.name);
    });
  }
  // kick off any program logic or start listening to external events
  runProgramLogic();
};

const runProgramLogic = () =>
  Object.keys(collectionStore)
    .map(name => collectionStore[name])
    .map(collection => {
      console.log(`Number of entries in collection '${collection.name}': ${collection.count()}`);
    });

export const startDatabase = (file = 'rest_easy_loki.db', cb?: () => void) => {
  const autoloadCallback = cb
    ? () => {
        databaseInitialize();
        cb();
      }
    : () => databaseInitialize();

  db = new loki(file, {
    // Since our LokiFsStructuredAdapter is partitioned, the default 'rest_easy_loki.db'
    // file will actually contain only the loki database shell and each of the collections
    // will be saved into independent 'partition' files with numeric suffix.
    adapter: new LokiFsAdapter(),
    autoload: true,
    autoloadCallback,
    autosave: true,
    autosaveInterval: 4000,
  } as Partial<LokiConfigOptions>);
};

// const db2 = new loki('rest_easy_loki.db', {
//   // Since our LokiFsStructuredAdapter is partitioned, the default 'rest_easy_loki.db'
//   // file will actually contain only the loki database shell and each of the collections
//   // will be saved into independent 'partition' files with numeric suffix.
//   adapter: new LokiFsAdapter(),
//   autoload: true,
//   autoloadCallback: databaseInitialize,
//   autosave: true,
//   autosaveInterval: 4000,
// } as Partial<LokiConfigOptions>);

// Since autosave timer keeps program from exiting, we exit this program by ctrl-c.
// (optionally) For best practice, lets use the standard exit events to force a db flush to disk
//    if autosave timer has not had a fired yet (if exiting before 4 seconds).
process.on('SIGINT', () => {
  console.log('flushing database...');
  db.close();
  process.exit(0);
});

export const createCollection = (collectionName: string, indices?: string[]) => {
  collectionStore[collectionName] = db.addCollection(collectionName, { indices });
};

export const post = (collectionName: string, item: unknown) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    createCollection(collectionName);
  }
  return collectionStore[collectionName].insert(item);
};

export const collections = () =>
  Object.keys(collectionStore)
    .map(key => collectionStore[key])
    .map(col => ({ name: col.name, entries: col.count() }));

export const del = (collectionName: string, id: number) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return false;
  }
  const item = collectionStore[collectionName].get(id);
  if (item) {
    return collectionStore[collectionName].remove(item);
  }
  return false;
};

export const update = (collectionName: string, id: number, item: any) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return false;
  }
  const collection = collectionStore[collectionName];
  const it = collection.get(id);
  return collection.update(Object.assign(it, item));
};

export const updateItem = (collectionName: string, item: any) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return false;
  }
  return collectionStore[collectionName].update(item);
};

export const get = (collectionName: string, query: string | number | { [key: string]: any }) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collectionStore[collectionName];
  if (typeof query === 'number') {
    return collection.get(query);
  }
  if (typeof query === 'string') {
    const q = query
      ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
      : undefined;
    return q ? collection.find(q) : undefined;
  }
  return collection.find(query);
};

export const findOne = (collectionName: string, query: string | number | { [key: string]: any }) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collectionStore[collectionName];
  if (typeof query === 'number') {
    return collection.get(query);
  }
  if (typeof query === 'string') {
    const q = query
      ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
      : undefined;
    return q ? collection.findOne(q) : undefined;
  }
  return collection.findOne(query);
};

export const all = (collectionName: string, query?: string) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collectionStore[collectionName];
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
