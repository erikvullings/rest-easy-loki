import Router from 'koa-router';
import { applyPatch } from 'rfc6902';
import IO from 'socket.io';
import { all, collections, del, get, post, update } from './database';
import { environment } from './environment';
import { IMutation } from './models';
import { ILokiObj } from './models/loki-obj';
import { paginationFilter, propertyMap } from './utils';

export const createRouter = (io?: IO.Server) => {
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
    const results = all(collection, query);
    ctx.body = map && results ? (filter ? results.filter(filter).map(map) : results.map(map)) : results;
  });

  /** Get by ID */
  router.get('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    ctx.body = get(collection, +id);
  });

  /** Get by unique ID */
  router.get('/api/:collection/:unique/:id', async (ctx) => {
    const { collection, id, unique } = ctx.params;
    ctx.body = get(collection, id, unique);
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
      setTimeout(() => io.emit(collection, ctx.body), 0);
    }
  });

  router.put('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    const item = ctx.request.body as ILokiObj;
    if (item.$loki !== +id) {
      ctx.throw('Item ID does not match route ID.');
    }
    ctx.body = update(collection, item);
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`, ctx.body), 0);
    }
  });

  router.patch('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    if (id) {
      const item = get(collection, +id);
      const mutation = ctx.request.body as IMutation;
      if (item && mutation && mutation.patch) {
        const { saveChanges, patch } = mutation;
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
            setTimeout(() => io.emit(`${collection}/${id}`, ctx.body), 0);
          }
        }
      }
    }
  });

  router.put('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const item = ctx.request.body;
    ctx.body = update(collection, item);
    if (io && item.id) {
      setTimeout(() => io.emit(`${collection}/${item.id}`, ctx.body), 0);
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
