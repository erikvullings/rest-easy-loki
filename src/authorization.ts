import * as Koa from 'koa';

const getApiKeys = () => {
  return {
    whitelist: process.env.LOKI_AUTHZ_WHITELIST
      ? process.env.LOKI_AUTHZ_WHITELIST.toUpperCase()
          .split(',')
          .map((x) => x.trim())
      : [],
    create: process.env.LOKI_AUTHZ_CREATE
      ? process.env.LOKI_AUTHZ_CREATE.toUpperCase()
          .split(',')
          .map((x) => x.trim())
      : [],
    read: process.env.LOKI_AUTHZ_READ
      ? process.env.LOKI_AUTHZ_READ.toUpperCase()
          .split(',')
          .map((x) => x.trim())
      : [],
    update: process.env.LOKI_AUTHZ_UPDATE
      ? process.env.LOKI_AUTHZ_UPDATE.toUpperCase()
          .split(',')
          .map((x) => x.trim())
      : [],
    delete: process.env.LOKI_AUTHZ_DELETE
      ? process.env.LOKI_AUTHZ_DELETE.toUpperCase()
          .split(',')
          .map((x) => x.trim())
      : [],
  } as {
    /** Domain names that are white listed */
    whitelist: string[];
    /** API keys that allow CREATE operations */
    create: string[];
    /** API keys that allow READ operations */
    read: string[];
    /** API keys that allow UPDATE operations */
    update: string[];
    /** API keys that allow DELETE operations */
    delete: string[];
  };
};

const apiKeys = getApiKeys();
if (apiKeys.whitelist.length > 0) {
  console.log(`Whitelisting the following sites: ${apiKeys.whitelist.join(', ')}.`);
}

/** Get the API key (x-api-key) from the request header */
const retreiveApiKey = (ctx: Koa.Context): string | undefined => {
  const apiKey = ctx.get('x-api-key');
  return apiKey ? apiKey.toUpperCase() : undefined;
};

const dp = (keys: string[], apiKey: string | undefined, ctx: Koa.Context) => {
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

/** Policy decision point, decides whether the requested action is allowed. */
const pdp = (ctx: Koa.Context): boolean => {
  // Whitelisted
  if (apiKeys.whitelist.length > 0) {
    // console.table(apiKeys);
    const hostname = ctx.hostname && ctx.hostname.toUpperCase();
    // console.table(hostname);
    if (hostname && apiKeys.whitelist.includes(hostname)) {
      return true;
    }
  }

  const apiKey = retreiveApiKey(ctx);

  switch (ctx.request.method.toUpperCase()) {
    case 'GET':
      return dp(apiKeys.read, apiKey, ctx);
    case 'POST':
      return dp(apiKeys.create, apiKey, ctx);
    case 'DELETE':
      return dp(apiKeys.delete, apiKey, ctx);
    default:
      return dp(apiKeys.update, apiKey, ctx); // put or patch
  }
};

/** Simple Policy Enforcement Point */
export const pep = async (ctx: Koa.Context, next: () => Promise<any>) => {
  if (pdp(ctx)) {
    // Use await next. See here: https://github.com/ZijianHe/koa-router/issues/358
    await next();
  }
};
