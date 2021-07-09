export { createApi } from './api';
export * from './models';
import Router from 'koa-router';
export { Router };

import { all, collections, createCollection, del, findOne, get, post, startDatabase, update } from './database';

export const db = {
  all,
  createCollection,
  collections,
  del,
  get,
  findOne,
  post,
  startDatabase,
  update,
};
