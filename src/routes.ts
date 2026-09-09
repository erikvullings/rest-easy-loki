import type Koa from 'koa';
import Router from 'koa-router';
import IO from 'socket.io';
import {
  CollectionAccess,
  CollectionAccessError,
  CollectionQuery,
  isJsonPatch,
  RecordIdentity,
} from './collection-access';
import { getCollectionAccess } from './database';
import { environment } from './environment';
import { Resolver } from './models';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectBody = (ctx: Koa.Context): Record<string, unknown> => {
  const body = ctx.request.body;
  if (!isObject(body)) {
    throw new CollectionAccessError('INVALID_RECORD', 'Request body must be a JSON object.', 400);
  }
  return body;
};

const queryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return typeof value === 'string' ? value : undefined;
};

const nonNegativeInteger = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CollectionAccessError('INVALID_PAGINATION', `${name} must be a non-negative integer.`, 400);
  }
  return parsed;
};

const collectionQuery = (query: Koa.Context['query'], includeProjection: boolean): CollectionQuery => {
  const filterText = queryValue(query.q);
  let filter: Record<string, unknown> | undefined;
  if (filterText) {
    try {
      const parsed: unknown = JSON.parse(filterText);
      if (!isObject(parsed)) {
        throw new Error('Filter must be a JSON object.');
      }
      filter = parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CollectionAccessError('INVALID_FILTER', `Malformed query filter: ${message}`, 400);
    }
  }

  const from = nonNegativeInteger(queryValue(query.from), 'from');
  const to = nonNegativeInteger(queryValue(query.to), 'to');
  const offset = from ?? 0;
  if (to !== undefined && to < offset) {
    throw new CollectionAccessError('INVALID_PAGINATION', 'to must be greater than or equal to from.', 400);
  }

  const sort = queryValue(query.sort);
  const directions = (queryValue(query.order) || '')
    .split(',')
    .filter(Boolean)
    .map((direction) => direction.toLowerCase());
  const orderBy = sort
    ? sort.split(',').map((field, index) => ({
        field: field.trim(),
        direction: directions[index] as 'asc' | 'desc' | undefined,
      }))
    : undefined;

  return {
    filter,
    projection: includeProjection ? queryValue(query.props)?.split(',').map((property) => property.trim()) : undefined,
    offset: from,
    limit: to === undefined ? undefined : to - offset + 1,
    orderBy,
  };
};

const withResolver = async (
  operation: () => Promise<Record<string, unknown>>,
  resolve: Resolver | undefined,
  request: Parameters<Resolver>[0],
) => {
  try {
    return await operation();
  } catch (error) {
    if (
      resolve &&
      error instanceof CollectionAccessError &&
      (error.code === 'RECORD_NOT_FOUND' || error.code === 'COLLECTION_NOT_FOUND')
    ) {
      return resolve(request);
    }
    throw error;
  }
};

export const createRouter = (
  io?: IO.Server,
  resolve?: Resolver,
  collections: CollectionAccess = getCollectionAccess(),
): Router => {
  const router = new Router();

  router.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof CollectionAccessError) {
        ctx.status = error.status;
        ctx.body = { error: { code: error.code, message: error.message } };
        return;
      }
      throw error;
    }
  });

  router.get('/api/env', async (ctx) => {
    ctx.body = environment();
  });

  router.get('/api/collections', async (ctx) => {
    ctx.status = 201;
    ctx.body = collections.collections();
  });

  router.get('/api/:collection/view', async (ctx) => {
    const { collection } = ctx.params;
    try {
      ctx.body = await collections.query(collection, collectionQuery(ctx.query, true));
    } catch (error) {
      if (resolve && error instanceof CollectionAccessError && error.code === 'COLLECTION_NOT_FOUND') {
        ctx.body = await resolve({ query: ctx.query.q });
        return;
      }
      throw error;
    }
  });

  router.get('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    const numericId = Number(id);
    ctx.body = await withResolver(
      () => collections.get(collection, numericId),
      resolve,
      { uniqueId: '$loki', id: numericId },
    );
  });

  router.get('/api/:collection/:unique/:id', async (ctx) => {
    const { collection, id, unique } = ctx.params;
    ctx.body = await withResolver(
      () => collections.get(collection, { [unique]: id }),
      resolve,
      { uniqueId: unique, id },
    );
  });

  router.get('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    ctx.body = await collections.query(collection, collectionQuery(ctx.query, false));
  });

  router.post('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const item = objectBody(ctx);
    ctx.body = await collections.create(collection, item);
    if (io) {
      setTimeout(() => io.emit(collection, ctx.body), 0);
    }
  });

  router.put('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    const item = objectBody(ctx);
    ctx.body = await collections.replace(collection, Number(id), item);
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`, ctx.body), 0);
    }
  });

  router.patch('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    const mutation = objectBody(ctx);
    if (!isJsonPatch(mutation.patch)) {
      throw new CollectionAccessError('INVALID_PATCH', 'Request must contain a non-empty RFC 6902 patch.', 400);
    }
    ctx.body = await collections.patch(collection, Number(id), mutation.patch);
    if (typeof mutation.saveChanges === 'string') {
      const changeRecord = { ...mutation };
      delete changeRecord.saveChanges;
      await collections.create(mutation.saveChanges, changeRecord);
    }
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`, ctx.body), 0);
    }
  });

  router.put('/api/:collection', async (ctx) => {
    const { collection } = ctx.params;
    const item = objectBody(ctx);
    const identity: RecordIdentity =
      typeof item.$loki === 'number'
        ? item.$loki
        : (() => {
            throw new CollectionAccessError(
              'INVALID_IDENTITY',
              "The legacy collection PUT route requires a numeric '$loki' property.",
              400,
            );
          })();
    ctx.body = await collections.replace(collection, identity, item);
    if (io) {
      setTimeout(() => io.emit(`${collection}/${identity}`, ctx.body), 0);
    }
  });

  router.delete('/api/:collection/:id', async (ctx) => {
    const { collection, id } = ctx.params;
    ctx.body = await collections.delete(collection, Number(id));
    if (io) {
      setTimeout(() => io.emit(`${collection}/${id}`), 0);
    }
  });

  return router;
};
