import type { ParsedUrlQuery } from 'querystring';

export interface PolicyRule {
  method: string;
  path: string;
  query?: ParsedUrlQuery;
  abac?: Record<string, string>;
}

export interface PublicRouteRule {
  method?: string;
  path: string;
}

interface AuthorizationBase {
  publicRoutes?: PublicRouteRule[];
}

export interface NoAuthorizationConfiguration extends AuthorizationBase {
  mode: 'none';
}

export interface ApiKeyAuthorizationConfiguration extends AuthorizationBase {
  mode: 'apiKey';
  whitelist?: string[];
  keys: {
    create?: string[];
    read?: string[];
    update?: string[];
    delete?: string[];
  };
}

export interface JwtAuthorizationConfiguration extends AuthorizationBase {
  mode: 'jwt';
  sharedSecret?: string;
  jwksUrl?: string;
  anonymousRead?: boolean;
  rules?: PolicyRule[];
}

export type AuthorizationConfiguration =
  | NoAuthorizationConfiguration
  | ApiKeyAuthorizationConfiguration
  | JwtAuthorizationConfiguration;
