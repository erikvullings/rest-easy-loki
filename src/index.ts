export { config } from './config';
export { createApi } from './api';
export { CollectionAccessError, createCollectionAccess, isJsonPatch } from './collection-access';
export type {
  BulkMutation,
  CollectionAccess,
  CollectionAccessErrorCode,
  CollectionQuery,
  RecordIdentity,
} from './collection-access';
export { createDatabaseLifecycle } from './database-lifecycle';
export type {
  DatabaseLifecycle,
  DatabaseLifecycleOptions,
  DatabaseLifecycleState,
} from './database-lifecycle';
export * from './models';
import Router from 'koa-router';
export { Router };

import {
  all,
  collections,
  createCollection,
  del,
  findOne,
  get,
  post,
  rebuildDatabase,
  shutdownDatabase,
  startDatabase,
  update,
} from './database';

export const db = {
  all,
  createCollection,
  collections,
  del,
  get,
  findOne,
  post,
  rebuildDatabase,
  shutdownDatabase,
  startDatabase,
  update,
};
