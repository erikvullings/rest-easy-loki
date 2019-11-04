import * as Koa from 'koa';

const getApiKeys = () => {
  return {
    create: process.env.LOKI_AUTHZ_CREATE
      ? process.env.LOKI_AUTHZ_CREATE.toUpperCase()
          .split(',')
          .map(x => x.trim())
      : [],
    read: process.env.LOKI_AUTHZ_READ
      ? process.env.LOKI_AUTHZ_READ.toUpperCase()
          .split(',')
          .map(x => x.trim())
      : [],
    update: process.env.LOKI_AUTHZ_UPDATE
      ? process.env.LOKI_AUTHZ_UPDATE.toUpperCase()
          .split(',')
          .map(x => x.trim())
      : [],
    delete: process.env.LOKI_AUTHZ_DELETE
      ? process.env.LOKI_AUTHZ_DELETE.toUpperCase()
          .split(',')
          .map(x => x.trim())
      : [],
  } as {
    create: string[];
    read: string[];
    update: string[];
    delete: string[];
  };
};

const apiKeys = getApiKeys();

/** Get the API key (x-api-key) from the request header */
const retreiveApiKey = (ctx: Koa.Context): string | undefined => {
  const apiKey = ctx.get('x-api-key');
  return apiKey ? apiKey.toUpperCase() : undefined;
};

/** Policy decision point, decides whether the requested action is allowed. */
const pdp = (ctx: Koa.Context): boolean => {
  console.log(ctx.host);
  console.log(ctx.hostname);
  const apiKey = retreiveApiKey(ctx);
  const dp = (keys: string[]) => {
    if (keys.length === 0) {
      return true;
    }
    if (!apiKey) {
      ctx.body = 'The header must contain an API key, x-api-key = ...';
      ctx.status = 401; // Unauthenticated
      return false;
    } else if (keys.indexOf(apiKey) < 0) {
      ctx.status = 403; // Forbidden
      return false;
    }
    return true;
  };

  switch (ctx.request.method.toUpperCase()) {
    case 'GET':
      return dp(apiKeys.read);
    case 'POST':
      return dp(apiKeys.create);
    case 'DELETE':
      return dp(apiKeys.delete);
    default:
      return dp(apiKeys.update); // put or patch
  }
};

/** Simple Policy Enforcement Point */
export const pep = (ctx: Koa.Context, next: () => Promise<any>) => {
  if (!apiKeys) {
    next();
  }
  if (pdp(ctx)) {
    next();
  }
};
