import * as Koa from 'koa';
import * as jose from 'jose';

const getApiKeys = () => {
  return {
    jwtShared: process.env.LOKI_AUTHZ_JWT_SHARED
      ? new TextEncoder().encode(process.env.LOKI_AUTHZ_JWT_SHARED)
      : undefined,
    jwtJwks: process.env.LOKI_AUTHZ_JWT_JWKS
      ? jose.createRemoteJWKSet(new URL(process.env.LOKI_AUTHZ_JWT_JWKS))
      : undefined,
    jwtAnonymousRead: process.env.LOKI_AUTHZ_JWT_ANONYMOUS_READ != undefined ? true : false,
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
    /** The JWT shared key */
    jwtShared: Uint8Array | undefined;
    /** The JWKS instance */
    jwtJwks: jose.JWTVerifyGetKey | undefined;
    /** Whether to allow read without valid JWT. */
    jwtAnonymousRead: boolean;
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

/** Check for a bearer key in the Authorization header */
const retrieveBearerToken = (ctx: Koa.Context): string | undefined => {
  const authorizationHeader = ctx.get('authorization');

  const parts = authorizationHeader.trim().split(' ');
  if (parts.length !== 2) return undefined;
  if (parts[0] != 'Bearer') return undefined;
  return parts[1];
}

const dp = (keys: string[], apiKey: string | undefined, ctx: Koa.Context): boolean => {
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

const jdp = (roles: string[], role: string, ctx: Koa.Context): boolean => {
  if (!roles.includes(role)) {
    ctx.status = 403; // Forbidden
    return false;
  }

  return true;
};

/** Policy decision point, decides whether the requested action is allowed. */
const pdp = async (ctx: Koa.Context): Promise<boolean> => {
  if (apiKeys.jwtShared !== undefined || apiKeys.jwtJwks !== undefined) {
    if (apiKeys.jwtAnonymousRead && ctx.request.method.toUpperCase() === 'GET') {
      return true;
    }

    const bearerToken = retrieveBearerToken(ctx);

    if (bearerToken === undefined) {
      ctx.body = 'Authorization header doesn\'t contain a JWT token';
      ctx.status = 401; // Unauthenticated
      return false;
    }

    let roles: string[] = [];

    try {
      if (apiKeys.jwtShared !== undefined) {
        const { payload } = await jose.jwtVerify(bearerToken, apiKeys.jwtShared);
        roles = (payload.realm_access as any).roles as string[] ?? [];
      } else if (apiKeys.jwtJwks !== undefined) {
        const { payload } = await jose.jwtVerify(bearerToken, apiKeys.jwtJwks);
        roles = (payload.realm_access as any).roles as string[] ?? [];
      }
    } catch {
      ctx.body = 'Authorization header doesn\'t contain a valid JWT token';
      ctx.status = 401; // Unauthenticated
      return false;
    }

    switch (ctx.request.method.toUpperCase()) {
      case 'GET':
        return true; // If the JWT is valid, reading is allowed.
      case 'POST':
        return jdp(roles, "editor", ctx);
      case 'DELETE':
        return jdp(roles, "editor", ctx);
      default:
        return jdp(roles, "editor", ctx); // put or patch
    }
  }

  // Whitelisted
  if (apiKeys.whitelist.length > 0) {
    const hostname = ctx.hostname && ctx.hostname.toUpperCase();
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
  const allowed = await pdp(ctx);
  // console.log('Allowed: ' + allowed);
  if (allowed) {
    // Use await next. See here: https://github.com/ZijianHe/koa-router/issues/358
    await next();
  }
};
