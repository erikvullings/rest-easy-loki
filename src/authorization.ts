import * as Koa from 'koa';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { AccessControlOptions, createRouteBasedAccessControl, PolicyEvaluator } from './route-based-access-control';
import { readPolicies } from './utils';
import { config } from './config';

const getApiKeys = () => {
  return {
    jwtShared: process.env.LOKI_AUTHZ_JWT_SHARED
      ? new TextEncoder().encode(process.env.LOKI_AUTHZ_JWT_SHARED)
      : undefined,
    jwtJwks: process.env.LOKI_AUTHZ_JWT_JWKS ? createRemoteJWKSet(new URL(process.env.LOKI_AUTHZ_JWT_JWKS)) : undefined,
    jwtAnonymousRead:
      process.env.LOKI_AUTHZ_JWT_ANONYMOUS_READ && process.env.LOKI_AUTHZ_JWT_ANONYMOUS_READ.toLowerCase() === 'true',
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
    jwtJwks: JWTVerifyGetKey | undefined;
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

/** Get the API key (x-api-key) from the request header */
const retreiveApiKey = (ctx: Koa.Context): string | undefined => {
  const apiKey = ctx.get('x-api-key');
  return apiKey ? apiKey.toUpperCase() : undefined;
};

const defaultPolicyEvaluator: PolicyEvaluator = () => {
  console.log('No policies are defined - all requests are forbidden');
  // ctx.status = 403; // Forbidden
  return false;
};

/** Policy decision point, decides whether the requested action is allowed. */
const pdpFactory = (policyFile?: string, options?: AccessControlOptions) => {
  if (config.debug) {
    console.log('Loaded policyfile:', policyFile);
  }
  const rules = readPolicies(policyFile);
  const policies = rules.length > 0 ? createRouteBasedAccessControl(rules, options) : defaultPolicyEvaluator;
  const apiKeys = getApiKeys();

  const { jwtShared, jwtJwks, jwtAnonymousRead } = apiKeys;

  if (jwtShared || jwtJwks) {
    console.log(
      `Using ${jwtShared ? 'symmetric shared-key' : 'assymmetric'} JSON Web Tokens (JWT) for authorization.${
        jwtAnonymousRead ? 'mAnonymous reading is supported.' : ''
      }`,
    );

    /** Check for a bearer key in the Authorization header */
    const retrieveBearerToken = (ctx: Koa.Context): string | undefined => {
      const authorizationHeader = ctx.get('authorization');

      const parts = authorizationHeader.trim().split(' ');
      if (parts.length !== 2) return undefined;
      if (parts[0].toLowerCase() != 'bearer') return undefined;
      return parts[1];
    };

    return async (ctx: Koa.Context): Promise<boolean> => {
      const requestMethod = ctx.request.method.toUpperCase();
      if (jwtAnonymousRead && requestMethod === 'GET') {
        return true;
      }

      const bearerToken = retrieveBearerToken(ctx);

      if (bearerToken === undefined) {
        // ctx.body = "Authorization header doesn't contain a JWT token, i.e. `Bearer <YOUR_TOKEN>`";
        // ctx.status = 401;
        // return false;
        ctx.throw(401, "Authorization header doesn't contain a JWT token, i.e. `Bearer <YOUR_TOKEN>`\n"); // Unauthenticated
      }

      try {
        const { payload } = jwtShared
          ? await jwtVerify(bearerToken, jwtShared)
          : jwtJwks
          ? await jwtVerify(bearerToken, jwtJwks)
          : { payload: {} as { [key: string]: any } };
        // roles = payload.roles ?? payload.realm_access?.roles ?? [];
        const { path: requestPath, query } = ctx.request;
        return policies(requestMethod, requestPath, query, payload);
      } catch {
        if (config.debug) {
          console.log("Authorization header doesn't contain a *valid* JWT token");
        }
        // ctx.body = "Authorization header doesn't contain a valid JWT token";
        // ctx.status = 401; // Unauthenticated
        // return false;
        ctx.throw(401, "Authorization header doesn't contain a JWT token\n"); // Unauthenticated
      }
    };
  }

  if (apiKeys.whitelist.length > 0) {
    console.log(`Whitelisting the following sites: ${apiKeys.whitelist.join(', ')}.`);
  }

  const dp = (keys: string[], apiKey: string | undefined, ctx: Koa.Context): boolean => {
    if (keys.length === 0) {
      return true;
    }
    if (!apiKey) {
      // ctx.body = 'The header must contain an API key, x-api-key = ...';
      // ctx.status = 401; // Unauthenticated
      // return false;
      ctx.throw(401, 'The header must contain an API key, x-api-key = ...\n'); // Unauthenticated
    } else if (keys.indexOf(apiKey) < 0) {
      // ctx.status = 403; // Forbidden
      // return false;
      ctx.throw(403, 'Access forbidden\n'); // Forbidden
    }
    return true;
  };

  return async (ctx: Koa.Context): Promise<boolean> => {
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
};

/** Simple Policy Enforcement Point */
export const pep = (policyFile?: string, options?: AccessControlOptions) => {
  const pdp = pdpFactory(policyFile, options);
  return async (ctx: Koa.Context, next: () => Promise<any>) => {
    const allowed = await pdp(ctx);
    if (!allowed) {
      ctx.throw(403, 'Access forbidden\n');
    }
    // Use await next. See here: https://github.com/ZijianHe/koa-router/issues/358
    else await next();
  };
};
