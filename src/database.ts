import fs from 'fs';
import loki, { Collection } from 'lokijs';
import { ILokiConfiguration } from './models';
import { sortByDateDesc } from './utils';
import lfsa from 'lokijs/src/loki-fs-structured-adapter';

let db: loki;

const collectionStore = {} as { [key: string]: Collection };

const importJSON = (collectionName: string, filename: string) => {
  if (!fs.existsSync(filename)) return;
  fs.readFile(filename, (err, data) => {
    if (err) {
      console.error(err);
      return;
    }
    try {
      const json = JSON.parse(data.toString());
      const collection = db.getCollection(collectionName);
      if (json instanceof Array) {
        collection.insert(json);
        // for (const o of json) {
        //   collection.insertOne
        // }
      } else {
        console.warn(`JSON file is not an array! Ignoring ${filename}.`);
      }
    } catch (e) {
      console.error(e);
    }
  });
};

const databaseInitialize = (options?: ILokiConfiguration) => {
  if (db.collections && db.collections.length > 0) {
    db.collections.forEach((c) => {
      collectionStore[c.name] = db.getCollection(c.name);
    });
  } else if (options) {
    const { collections } = options;
    if (collections && typeof collections === 'object') {
      for (const collectionName of Object.keys(collections)) {
        const collection = collections[collectionName];
        db.addCollection(collectionName, collection);
        collection.jsonImport && importJSON(collectionName, collection.jsonImport);
      }
    }
    db.collections.forEach((c) => {
      collectionStore[c.name] = db.getCollection(c.name);
    });
  }
  // kick off any program logic or start listening to external events
  runProgramLogic();
};

const runProgramLogic = () =>
  Object.keys(collectionStore)
    .map((name) => collectionStore[name])
    .map((collection) => {
      console.log(`Number of entries in collection '${collection.name}': ${collection.count()}`);
    });

export const startDatabase = (file = 'rest_easy_loki.db', cb?: () => void, options?: ILokiConfiguration) => {
  const autoloadCallback = cb
    ? () => {
        databaseInitialize(options);
        cb();
      }
    : () => databaseInitialize(options);

  db = new loki(file, {
    // Since our LokiFsStructuredAdapter is partitioned, the default 'rest_easy_loki.db'
    // file will actually contain only the loki database shell and each of the collections
    // will be saved into independent 'partition' files with numeric suffix.
    adapter: new lfsa(),
    autoload: true,
    autoloadCallback,
    autosave: true,
    autosaveInterval: 4000,
  } as Partial<LokiConfigOptions>);
};

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
    .map((key) => collectionStore[key])
    .map((col) => ({ name: col.name, entries: col.count() }));

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

export const update = (collectionName: string, item: any) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return false;
  }
  return collectionStore[collectionName].update(item);
};

export const get = (collectionName: string, query: string | number | { [key: string]: any }, by?: string) => {
  if (!collectionStore.hasOwnProperty(collectionName)) {
    return;
  }
  const collection = collectionStore[collectionName];
  if (by) {
    return collection.by(by, query);
  }
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
  return q ? collection.chain().find(q).sort(sortByDateDesc).data() : collection.chain().sort(sortByDateDesc).data();
};
