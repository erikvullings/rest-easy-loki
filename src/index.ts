import Koa from 'koa';
import bodyParser from 'koa-body';
import serve from 'koa-static';
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
import { logger } from './logging';
import { routes } from './routes';

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

export const api: Koa = new Koa();

api.use(bodyParser());
api.use(logger);
api.use(serve('./public'));
api.use(routes);
