import fs from 'fs';
import {
  ApiKeyAuthorizationConfiguration,
  AuthorizationConfiguration,
  EnvironmentValue,
  ICommandOptions,
  JwtAuthorizationConfiguration,
  PolicyRule,
  PublicRouteRule,
} from './models';
import { environment } from './environment';

export interface ValidatedConfiguration extends ICommandOptions {
  db: string;
  port: number;
  cors: boolean;
  io: boolean;
  pretty: boolean;
  sizeLimit: string;
  compression: boolean;
  debug: boolean;
  authorization: AuthorizationConfiguration;
  environment: Record<string, EnvironmentValue>;
}

export class ConfigurationError extends Error {
  public readonly code = 'INVALID_CONFIGURATION';

  public constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export const defaultConfiguration: ValidatedConfiguration = {
  help: false,
  public: './public',
  pretty: true,
  port: 3000,
  cors: true,
  io: false,
  db: 'rest_easy_loki.db',
  sizeLimit: '250mb',
  compression: true,
  debug: false,
  authorization: { mode: 'none', publicRoutes: [] },
  environment: {},
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validatePublicRoutes = (routes: PublicRouteRule[] | undefined): PublicRouteRule[] => {
  if (routes === undefined) {
    return [];
  }
  if (
    !Array.isArray(routes) ||
    routes.some(
      (route) =>
        !isObject(route) ||
        typeof route.path !== 'string' ||
        route.path.length === 0 ||
        (route.method !== undefined && typeof route.method !== 'string'),
    )
  ) {
    throw new ConfigurationError('authorization.publicRoutes must contain method/path rules.');
  }
  return routes.map((route) => ({
    path: route.path,
    method: route.method?.toUpperCase(),
  }));
};

const isPolicyRule = (rule: unknown): rule is PolicyRule => {
  if (
    !isObject(rule) ||
    typeof rule.method !== 'string' ||
    rule.method.length === 0 ||
    typeof rule.path !== 'string' ||
    rule.path.length === 0
  ) {
    return false;
  }
  if (
    rule.query !== undefined &&
    (!isObject(rule.query) ||
      Object.values(rule.query).some(
        (value) => typeof value !== 'string' && !(Array.isArray(value) && value.every((item) => typeof item === 'string')),
      ))
  ) {
    return false;
  }
  return (
    rule.abac === undefined ||
    (isObject(rule.abac) && Object.values(rule.abac).every((value) => typeof value === 'string'))
  );
};

const validatePolicyRules = (rules: unknown): PolicyRule[] => {
  if (!Array.isArray(rules) || !rules.every(isPolicyRule)) {
    throw new ConfigurationError(
      'JWT authorization rules require method/path strings and optional string-valued query/abac maps.',
    );
  }
  return rules;
};

const readPolicyRules = (filename: string): PolicyRule[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new ConfigurationError(
      `Could not read authorization policy '${filename}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(parsed) || !('rules' in parsed)) {
    throw new ConfigurationError(`Authorization policy '${filename}' must contain a rules array.`);
  }
  return validatePolicyRules(parsed.rules);
};

const validateAuthorization = (
  authorization: AuthorizationConfiguration | undefined,
  policyFile?: string,
): AuthorizationConfiguration => {
  const selected = authorization || defaultConfiguration.authorization;
  if (policyFile && selected.mode !== 'jwt') {
    throw new ConfigurationError('A policy file requires JWT authorization mode.');
  }
  const publicRoutes = validatePublicRoutes(selected.publicRoutes);
  switch (selected.mode) {
    case 'none':
      return { mode: 'none', publicRoutes };
    case 'apiKey': {
      const keys = selected.keys || {};
      const normalized: ApiKeyAuthorizationConfiguration = {
        mode: 'apiKey',
        publicRoutes,
        whitelist: normalizeList(selected.whitelist, 'authorization.whitelist'),
        keys: {
          create: normalizeList(keys.create, 'authorization.keys.create'),
          read: normalizeList(keys.read, 'authorization.keys.read'),
          update: normalizeList(keys.update, 'authorization.keys.update'),
          delete: normalizeList(keys.delete, 'authorization.keys.delete'),
        },
      };
      const configured =
        normalized.whitelist!.length > 0 ||
        Object.values(normalized.keys).some((values) => values && values.length > 0);
      if (!configured) {
        throw new ConfigurationError('API-key mode requires at least one key or whitelisted hostname.');
      }
      return normalized;
    }
    case 'jwt': {
      const sharedSecret =
        typeof selected.sharedSecret === 'string' && selected.sharedSecret.length > 0
          ? selected.sharedSecret
          : undefined;
      const jwksUrl =
        typeof selected.jwksUrl === 'string' && selected.jwksUrl.length > 0 ? selected.jwksUrl : undefined;
      const hasShared = sharedSecret !== undefined;
      const hasJwks = jwksUrl !== undefined;
      if (hasShared === hasJwks) {
        throw new ConfigurationError('JWT mode requires exactly one of sharedSecret or jwksUrl.');
      }
      if (hasJwks) {
        try {
          new URL(jwksUrl);
        } catch {
          throw new ConfigurationError('JWT jwksUrl must be an absolute URL.');
        }
      }
      const rules = selected.rules ? validatePolicyRules(selected.rules) : policyFile ? readPolicyRules(policyFile) : [];
      if (rules.length === 0 && !selected.anonymousRead && publicRoutes.length === 0) {
        throw new ConfigurationError('JWT mode requires authorization rules, anonymous reads, or public routes.');
      }
      const normalized: JwtAuthorizationConfiguration = {
        mode: 'jwt',
        publicRoutes,
        sharedSecret,
        jwksUrl,
        anonymousRead: selected.anonymousRead === true,
        rules,
      };
      return normalized;
    }
    default:
      throw new ConfigurationError('authorization.mode must be none, apiKey, or jwt.');
  }
};

const normalizeList = (values: string[] | undefined, name: string): string[] => {
  if (values === undefined) {
    return [];
  }
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new ConfigurationError(`${name} must be an array of strings.`);
  }
  return values.map((value) => value.trim().toUpperCase()).filter(Boolean);
};

export const validateConfiguration = (configuration: ICommandOptions): ValidatedConfiguration => {
  const merged = { ...defaultConfiguration, ...configuration };
  if (!merged.db || merged.db.trim().length === 0) {
    throw new ConfigurationError('Application configuration requires a database filename.');
  }
  if (!Number.isInteger(merged.port) || merged.port < 0 || merged.port > 65535) {
    throw new ConfigurationError('Application port must be an integer from 0 through 65535.');
  }
  if (typeof merged.sizeLimit !== 'string' || merged.sizeLimit.trim().length === 0) {
    throw new ConfigurationError('Application sizeLimit must be a non-empty string.');
  }
  return {
    ...merged,
    authorization: validateAuthorization(configuration.authorization, configuration.policies),
    environment: configuration.environment || {},
  };
};

const booleanValue = (source: Readonly<Record<string, string | undefined>>, name: string, fallback: boolean) => {
  const value = source[name];
  if (value === undefined) {
    return fallback;
  }
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }
  throw new ConfigurationError(`${name} must be true or false.`);
};

const listValue = (value: string | undefined): string[] =>
  value ? value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean) : [];

export const configurationFromEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): ICommandOptions => {
  const sharedSecret = source.LOKI_AUTHZ_JWT_SHARED;
  const jwksUrl = source.LOKI_AUTHZ_JWT_JWKS;
  const apiKeys = {
    create: listValue(source.LOKI_AUTHZ_CREATE),
    read: listValue(source.LOKI_AUTHZ_READ),
    update: listValue(source.LOKI_AUTHZ_UPDATE),
    delete: listValue(source.LOKI_AUTHZ_DELETE),
  };
  const whitelist = listValue(source.LOKI_AUTHZ_WHITELIST);
  const hasJwt = Boolean(sharedSecret || jwksUrl);
  const hasApiKey = whitelist.length > 0 || Object.values(apiKeys).some((values) => values.length > 0);
  if (hasJwt && hasApiKey) {
    throw new ConfigurationError('JWT and API-key environment settings cannot be combined.');
  }

  let authorization: AuthorizationConfiguration = { mode: 'none', publicRoutes: [] };
  if (hasJwt) {
    authorization = {
      mode: 'jwt',
      sharedSecret,
      jwksUrl,
      anonymousRead: booleanValue(source, 'LOKI_AUTHZ_JWT_ANONYMOUS_READ', false),
      publicRoutes: [],
    };
  } else if (hasApiKey) {
    authorization = {
      mode: 'apiKey',
      keys: apiKeys,
      whitelist,
      publicRoutes: [],
    };
  }

  const portText = source.LOKI_PORT;
  const port = portText === undefined ? defaultConfiguration.port : Number(portText);
  if (!Number.isInteger(port)) {
    throw new ConfigurationError('LOKI_PORT must be an integer.');
  }
  return {
    ...defaultConfiguration,
    public: source.LOKI_PUBLIC ?? defaultConfiguration.public,
    pretty: booleanValue(source, 'LOKI_PRETTY', defaultConfiguration.pretty),
    port,
    cors: booleanValue(source, 'LOKI_CORS', defaultConfiguration.cors),
    io: booleanValue(source, 'LOKI_IO', defaultConfiguration.io),
    db: source.LOKI_DB || defaultConfiguration.db,
    sizeLimit: source.LOKI_SIZE_LIMIT || defaultConfiguration.sizeLimit,
    config: source.LOKI_CONFIG,
    policies: source.LOKI_POLICIES,
    compression: booleanValue(source, 'LOKI_COMPRESSION', defaultConfiguration.compression),
    debug: booleanValue(source, 'LOKI_DEBUG', defaultConfiguration.debug),
    authorization,
    environment: environment(source),
  };
};
