import Application from 'koa';
import compose from 'koa-compose';
import Router from 'koa-router';
import { all, dbCollections, del, get, post, update, updateItem } from './database';
import { paginationFilter } from './utils';

const router = new Router();

router.get('/collections', async ctx => {
  ctx.status = 201;
  ctx.body = dbCollections();
});

router.get('/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  ctx.body = get(collection, +id);
});

/**
 * Request the whole collection
 * - Optionally, specify from and to as query params for pagination, e.g. ?from=0&to=5
 */
router.get('/:collection', async ctx => {
  const { collection } = ctx.params;
  const filter = paginationFilter(ctx.query);
  const results = all(collection, ctx.query.q);
  ctx.body = filter && results ? results.filter(filter) : results;
});

router.post('/:collection', async ctx => {
  const { collection } = ctx.params;
  const item = ctx.request.body;
  console.log(item);
  ctx.body = await post(collection, item);
});

router.put('/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  const item = ctx.request.body;
  ctx.body = update(collection, +id, item);
});

router.put('/:collection', async ctx => {
  const { collection } = ctx.params;
  const item = ctx.request.body;
  ctx.body = updateItem(collection, item);
});

router.delete('/:collection/:id', async ctx => {
  const { collection, id } = ctx.params;
  ctx.body = del(collection, +id);
});

export const routes: compose.Middleware<
  Application.ParameterizedContext<any, Router.IRouterParamContext<any, {}>>
> = router.routes();
