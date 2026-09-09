import { LokiDatabaseLifecycle } from './database-lifecycle';
import { CollectionAccess, createCollectionAccess } from './collection-access';
import { ILokiConfiguration } from './models';
import { sortByDateDesc } from './utils';

let lifecycle: LokiDatabaseLifecycle | undefined;
let access: CollectionAccess | undefined;

const database = () => {
  if (!lifecycle || lifecycle.state !== 'ready') {
    throw new Error('Database is not ready. Await startDatabase() before accessing collections.');
  }
  return lifecycle;
};

export const startDatabase = async (
  file = 'rest_easy_loki.db',
  callback?: () => void,
  options?: ILokiConfiguration,
): Promise<void> => {
  access = undefined;
  lifecycle = new LokiDatabaseLifecycle({ ...options, file });
  await lifecycle.start();
  access = createCollectionAccess(lifecycle);
  callback?.();
};

export const shutdownDatabase = async (): Promise<void> => {
  await lifecycle?.shutdown();
  access = undefined;
};

export const rebuildDatabase = async (): Promise<void> => {
  if (!lifecycle) {
    throw new Error('Database has not been started.');
  }
  await lifecycle.rebuild();
};

export const getCollectionAccess = (): CollectionAccess => {
  if (!access) {
    throw new Error('Database is not ready. Await startDatabase() before accessing collections.');
  }
  return access;
};

export const createCollection = (collectionName: string, indices?: string[]) => {
  database().createCollection(collectionName, { indices });
};

export const post = (collectionName: string, item: unknown) => {
  const active = database();
  const collection = active.collection(collectionName) || active.createCollection(collectionName);
  return collection.insert(item);
};

export const collections = () => database().collections();

export const del = (collectionName: string, id: number) => {
  const collection = database().collection(collectionName);
  return collection ? collection.remove(id) : false;
};

export const update = (collectionName: string, item: any) => {
  const collection = database().collection(collectionName);
  return collection ? collection.update(item) : false;
};

export const get = (collectionName: string, query: string | number | { [key: string]: any }, by?: string) => {
  const collection = database().collection(collectionName);
  if (!collection) {
    return;
  }
  if (by) {
    return collection.by(by, query);
  }
  if (typeof query === 'number') {
    return collection.get(query);
  }
  if (typeof query === 'string') {
    const parsed = query
      ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
      : undefined;
    return parsed ? collection.find(parsed) : undefined;
  }
  return collection.find(query);
};

export const findOne = (collectionName: string, query: string | number | { [key: string]: any }) => {
  const collection = database().collection(collectionName);
  if (!collection) {
    return;
  }
  if (typeof query === 'number') {
    return collection.get(query);
  }
  if (typeof query === 'string') {
    const parsed = query
      ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
      : undefined;
    return parsed ? collection.findOne(parsed) : undefined;
  }
  return collection.findOne(query);
};

export const all = (collectionName: string, query?: string) => {
  const collection = database().collection(collectionName);
  if (!collection) {
    return;
  }
  const parsed = query
    ? (JSON.parse(query) as { [prop: string]: string | number | { [ops: string]: string | number } })
    : undefined;
  return parsed
    ? collection.chain().find(parsed).sort(sortByDateDesc).data()
    : collection.chain().sort(sortByDateDesc).data();
};
