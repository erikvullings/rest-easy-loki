export { createApi } from './api';
import {
  all,
  collections,
  createCollection,
  del,
  findOne,
  get,
  post,
  startDatabase,
  update,
  updateItem,
} from './database';

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
  updateItem,
};
