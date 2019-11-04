import Router from 'koa-router';
import { all, collections, del, get, post, update, updateItem } from './database';
import { environment } from './environment';
import { paginationFilter, propertyMap } from './utils';

export const router = new Router();

router.get('/api/env', async ctx => {
  ctx.body = environment();
});

router.get('/api/collections', async ctx => {
  ctx.status = 201;
  ctx.body = collections();
});

/**
 * Request the whole collection but only returns a subset of all properties
 * - Specify `props` containing a comma separted array of top-level properties.
 * - Optionally, specify `from` and `to` as query params for pagination, e.g. ?from=0&to=5
 */
router.get('/api/:collection/view', async ctx => {
  const { collection } = ctx.params;
  const map = propertyMap(ctx.query);
  const filter = paginationFilter(ctx.query);
  const results = all(collection, ctx.query.q);
  ctx.body = map && results ? (filter ? results.filter(filter).map(map) : results.map(map)) : results;
});

/** Get by ID */
router.get('/api/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  ctx.body = get(collection, +id);
});

/**
 * Request the whole collection
 * - Optionally, specify from and to as query params for pagination, e.g. ?from=0&to=5
 */
router.get('/api/:collection', async ctx => {
  const { collection } = ctx.params;
  const pages = paginationFilter(ctx.query);
  const results = all(collection, ctx.query.q);
  ctx.body = pages && results ? results.filter(pages) : results;
});

router.post('/api/:collection', async ctx => {
  const { collection } = ctx.params;
  const item = ctx.request.body;
  ctx.body = post(collection, item);
});

router.put('/api/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  const item = ctx.request.body;
  ctx.body = update(collection, +id, item);
});

router.put('/api/:collection', async ctx => {
  const { collection } = ctx.params;
  const item = ctx.request.body;
  ctx.body = updateItem(collection, item);
});

router.delete('/api/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  ctx.body = del(collection, +id);
});

// export const routes: compose.Middleware<
//   Application.ParameterizedContext<any, Router.IRouterParamContext<any, {}>>
// > = router.routes();
