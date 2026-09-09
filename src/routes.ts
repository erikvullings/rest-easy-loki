import Router from 'koa-router';
import { applyPatch } from 'rfc6902';
import type { Operation } from 'rfc6902';
import IO from 'socket.io';
import type Koa from 'koa';
import { all, collections, del, get, post, update } from './database';
import { environment } from './environment';
import { Resolver } from './models';
import { paginationFilter, propertyMap } from './utils';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectBody = (ctx: Koa.Context): Record<string, unknown> => {
  const body = ctx.request.body;
  if (!isObject(body)) {
    ctx.throw(400, 'Request body must be a JSON object.');
  }
  return body;
};

const isOperation = (value: unknown): value is Operation => {
  if (!isObject(value) || typeof value.op !== 'string' || typeof value.path !== 'string') {
    return false;
  }
  switch (value.op) {
    case 'add':
    case 'replace':
    case 'test':
      return 'value' in value;
    case 'copy':
    case 'move':
      return typeof value.from === 'string';
    case 'remove':
      return true;
    default:
      return false;
  }
};

const isPatch = (value: unknown): value is Operation[] => Array.isArray(value) && value.every(isOperation);

export const createRouter: (io?: IO.Server, resolve?: Resolver) => Router = (io?: IO.Server, resolve?: Resolver) => {
  const router = new Router();

  router.get('/api/env', async (ctx) => {
    ctx.body = environment();
  });

  router.get('/api/collections', async (ctx) => {
    ctx.status = 201;
    ctx.body = collections();
  });

  /**
   * Request the whole collection but only returns a subset of all properties
   * - Specify `props` containing a comma separted array of top-level properties.
   * - Optionally, specify `from` and `to` as query params for pagination, e.g. ?from=0&to=5
   */
  router.get('/api/:collection/view', async (ctx) => {
    const { collection } = ctx.params;
    const map = propertyMap(ctx.query);
    const filter = paginationFilter(ctx.query);
    const query = ctx.query.q instanceof Array ? ctx.query.q.join('&') : ctx.query.q;
    const found = all(collection, query);
    const results = !resolve || (found && found.length > 0) ? found : await resolve({ query: ctx.query.q });
    ctx.body = map && results ? (filter ? results.filter(filter).map(map) : results.map(map)) : results;
  });

  /** Get by ID */
  router.get('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    ctx.body = get(collection, +id) || (resolve && (await resolve({ uniqueId: '$loki', id: +id })));
  });

  /** Get by unique ID */
  router.get('/api/:collection/:unique/:id', async (ctx) => {
    const { collection, id, unique } = ctx.params;
    ctx.body = get(collection, id, unique) || (resolve && (await resolve({ uniqueId: unique, id })));
  });

  /**
   * Request the whole collection
   * - Optionally, specify from and to as query params for pagination, e.g. ?from=0&to=5
   */
  router.get('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const pages = paginationFilter(ctx.query);
    const query = ctx.query.q instanceof Array ? ctx.query.q.join('&') : ctx.query.q;
    const results = all(collection, query);
    ctx.body = pages && results ? results.filter(pages) : results;
  });

  router.post('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const item = ctx.request.body;
    ctx.body = post(collection, item);
    if (io) {
      setTimeout(() => io.emit(collection, item), 0);
    }
  });

  router.put('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    const item = objectBody(ctx);
    if (item.$loki !== +id) {
      ctx.throw('Item ID does not match route ID.');
    }
    ctx.body = update(collection, item);
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`, item), 0);
    }
  });

  router.patch('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    if (id) {
      const item = get(collection, +id);
      const mutation = objectBody(ctx);
      if (item && isPatch(mutation.patch)) {
        const saveChanges = typeof mutation.saveChanges === 'string' ? mutation.saveChanges : undefined;
        const patch = mutation.patch;
        const errors = applyPatch(item, patch);
        const hasErrors = errors.some((e) => e !== null);
        if (hasErrors) {
          errors.forEach((e) => e && console.error(e));
          ctx.status = 409;
          ctx.body = errors;
        } else {
          if (saveChanges) {
            delete mutation.saveChanges;
            post(saveChanges, mutation);
          }
          ctx.body = update(collection, item);
          if (io) {
            setTimeout(() => io.emit(`${collection}/${id}`, item), 0);
          }
        }
      }
    }
  });

  router.put('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const item = objectBody(ctx);
    ctx.body = update(collection, item);
    if (io && item.id) {
      setTimeout(() => io.emit(`${collection}/${item.id}`, item), 0);
    }
  });

  router.delete('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    ctx.body = del(collection, +id);
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`), 0);
    }
  });

  // export const routes: compose.Middleware<
  //   Application.ParameterizedContext<any, Router.IRouterParamContext<any, {}>>
  // > = router.routes();

  return router;
};
