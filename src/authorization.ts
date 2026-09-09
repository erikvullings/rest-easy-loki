import type * as Koa from 'koa';
import type { AuthorizationConfiguration, PublicRouteRule } from './models';
import { createRouteBasedAccessControl } from './route-based-access-control';

export type AuthorizationErrorCode = 'AUTHENTICATION_REQUIRED' | 'INVALID_CREDENTIALS' | 'ACCESS_FORBIDDEN';

const routePattern = (path: string) =>
  new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');

const publicRouteMatcher = (rules: PublicRouteRule[]) => {
  const compiled = rules.map((rule) => ({
    method: rule.method?.toUpperCase(),
    path: routePattern(rule.path),
  }));
  return (ctx: Koa.Context) =>
    compiled.some(
      (rule) => (!rule.method || rule.method === ctx.method.toUpperCase()) && rule.path.test(ctx.request.path),
    );
};

const deny = (ctx: Koa.Context, status: 401 | 403, code: AuthorizationErrorCode, message: string) => {
  ctx.status = status;
  ctx.body = { error: { code, message } };
};

const bearerToken = (ctx: Koa.Context): string | undefined => {
  const [scheme, token, extra] = ctx.get('authorization').trim().split(/\s+/);
  return !extra && scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
};

export const pep = (
  authorization: AuthorizationConfiguration = { mode: 'none' },
  options: { enableLogging?: boolean; debug?: boolean } = {},
) => {
  const isPublic = publicRouteMatcher(authorization.publicRoutes || []);
  if (authorization.mode === 'none') {
    return async (_ctx: Koa.Context, next: () => Promise<unknown>) => next();
  }

  if (authorization.mode === 'apiKey') {
    const keys = {
      create: authorization.keys.create || [],
      read: authorization.keys.read || [],
      update: authorization.keys.update || [],
      delete: authorization.keys.delete || [],
    };
    return async (ctx: Koa.Context, next: () => Promise<unknown>) => {
      if (isPublic(ctx)) {
        await next();
        return;
      }
      const required =
        ctx.method === 'GET'
          ? keys.read
          : ctx.method === 'POST'
          ? keys.create
          : ctx.method === 'DELETE'
          ? keys.delete
          : keys.update;
      if (required.length === 0) {
        await next();
        return;
      }
      const provided = ctx.get('x-api-key');
      if (!provided) {
        deny(ctx, 401, 'AUTHENTICATION_REQUIRED', 'The x-api-key request header is required.');
        return;
      }
      if (!required.includes(provided.toUpperCase())) {
        deny(ctx, 403, 'ACCESS_FORBIDDEN', 'The supplied API key does not allow this action.');
        return;
      }
      await next();
    };
  }

  const jose = import('jose');
  const sharedKey = authorization.sharedSecret
    ? new TextEncoder().encode(authorization.sharedSecret)
    : undefined;
  const jwksUrl = authorization.jwksUrl;
  const remoteKey = jwksUrl
    ? jose.then(({ createRemoteJWKSet }) => createRemoteJWKSet(new URL(jwksUrl)))
    : undefined;
  const policies = createRouteBasedAccessControl(authorization.rules || [], options);

  return async (ctx: Koa.Context, next: () => Promise<unknown>) => {
    if (isPublic(ctx) || (authorization.anonymousRead && ctx.method === 'GET')) {
      await next();
      return;
    }
    const token = bearerToken(ctx);
    if (!token) {
      deny(ctx, 401, 'AUTHENTICATION_REQUIRED', 'A Bearer token is required.');
      return;
    }

    let payload;
    try {
      const { jwtVerify } = await jose;
      const key = sharedKey || (remoteKey && (await remoteKey));
      if (!key) {
        throw new Error('JWT authorization has no verification key.');
      }
      const verified = await jwtVerify(token, key);
      payload = verified.payload;
    } catch (error) {
      if (options.debug) {
        console.log('JWT verification failed:', error);
      }
      deny(ctx, 401, 'INVALID_CREDENTIALS', 'The supplied Bearer token is invalid.');
      return;
    }

    if (!policies(ctx.method.toUpperCase(), ctx.request.path, ctx.request.query, payload)) {
      deny(ctx, 403, 'ACCESS_FORBIDDEN', 'The authenticated subject is not authorized for this route.');
      return;
    }
    await next();
  };
};
