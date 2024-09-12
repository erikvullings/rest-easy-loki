import { JWTPayload } from 'jose';
import { ParsedUrlQuery } from 'querystring';
import { config } from './config';

export interface PolicyRule {
  method: string;
  path: string;
  query?: ParsedUrlQuery | { [key: string]: RegExp };
  abac?: { [key: string]: string };
}

export interface AccessControlOptions {
  enableLogging?: boolean;
}

export type PolicyEvaluator = (method: string, path: string, query: ParsedUrlQuery, jwtPayload: JWTPayload) => boolean;

export const createRouteBasedAccessControl = (
  policyFile?: PolicyRule[],
  options: AccessControlOptions = {},
): PolicyEvaluator => {
  interface CompiledRule extends PolicyRule {
    regex: RegExp;
    query?: { [key: string]: RegExp };
    pathPlaceholders: string[];
    queryPlaceholders: { [key: string]: string[] };
  }

  const canonicalizeQueryValue = (value: string | string[] = '') =>
    value.toString().replace(/"/g, "'").replace(/ /g, '');

  const policy: CompiledRule[] = (policyFile || []).map((rule) => {
    const pathPlaceholders: string[] = [];
    const regexPath = rule.path.replace(/\*/g, '.*').replace(/:([^/]+)/g, (_, placeholder) => {
      pathPlaceholders.push(placeholder);
      return '([^/]+)';
    });

    const queryPlaceholders: { [key: string]: string[] } = {};
    const compiledQuery = rule.query
      ? Object.fromEntries(
          Object.entries(rule.query).map(([key, value = '']) => {
            const placeholders: string[] = [];
            const compiledValue = canonicalizeQueryValue(value.toString())
              .replace(/\$/g, '\\$')
              .replace(/:([a-zA-Z][a-zA-Z\d]+)/g, (_, placeholder) => {
                placeholders.push(placeholder);
                return '([^&]+)';
              });
            queryPlaceholders[key] = placeholders;
            return [key, new RegExp(`^${compiledValue}$`)];
          }),
        )
      : undefined;

    return {
      ...rule,
      regex: new RegExp(`^${regexPath}$`, 'i'),
      pathPlaceholders,
      queryPlaceholders,
      query: compiledQuery,
    };
  });

  const checkProperty = (jwtPayload: JWTPayload, key: string, value: any): boolean => {
    if (config.debug) {
      console.log('Checking properties. JWT payload:', jwtPayload);
    }
    const keys = key.split('.');
    let current: any = jwtPayload;
    for (const k of keys) {
      if (current[k] === undefined) return false;
      current = current[k];
    }

    if (Array.isArray(current)) {
      return current.includes(value);
    } else {
      return current === value;
    }
  };

  const printRule = ({ method, path, query, abac }: CompiledRule) => JSON.stringify({ method, path, query, abac });

  return (method: string, path: string, query: ParsedUrlQuery, jwtPayload: JWTPayload): boolean => {
    for (const rule of policy) {
      if (config.debug) {
        console.log('Rule:', rule);
      }
      if (rule.method.toLowerCase() === method.toLowerCase()) {
        const pathMatch = path.match(rule.regex);
        if (pathMatch) {
          if (config.debug) {
            console.log('Pathmatch:', pathMatch);
          }
          // Check path placeholders
          const pathPlaceholderValues = pathMatch.slice(1);
          const pathPlaceholderCheck = rule.pathPlaceholders.every((placeholder, index) => {
            return checkProperty(jwtPayload, placeholder, pathPlaceholderValues[index]);
          });

          if (config.debug) {
            console.log('Path placeholder values:', pathPlaceholderValues);
            console.log('Path placeholder check:', pathPlaceholderCheck);
          }

          if (!pathPlaceholderCheck) {
            if (options.enableLogging) {
              console.log('Access denied: Path placeholder check failed for rule:', printRule(rule));
            }
            continue;
          }

          // Check query parameters
          if (rule.query) {
            const queryCheck = Object.entries(rule.query).every(([key, value]) => {
              if (config.debug) {
                console.log('Querycheck key:', key);
                console.log('Querycheck value:', value);
              }
              if (!(key in query)) return false;
              const canonicalQueryValue = canonicalizeQueryValue(query[key]);
              const valueMatch = canonicalQueryValue.match(value);
              if (config.debug) {
                console.log('Canonical query value:', canonicalQueryValue);
                console.log('Value match:', valueMatch);
              }
              if (!valueMatch) return false;

              // Check query placeholders
              const queryPlaceholderValues = valueMatch.slice(1);
              if (config.debug) {
                console.log('Query placeholder values:', queryPlaceholderValues);
              }
              return rule.queryPlaceholders[key].every((placeholder, index) => {
                return checkProperty(jwtPayload, placeholder, queryPlaceholderValues[index]);
              });
            });

            if (!queryCheck) {
              if (options.enableLogging) {
                console.log('Access denied: Query parameter check failed for rule:', printRule(rule));
              }
              continue;
            }
          }

          // Check ABAC rules
          if (rule.abac) {
            const abacCheck = Object.entries(rule.abac).every(([key, value]) => checkProperty(jwtPayload, key, value));
            if (options.enableLogging) {
              console.log(`Access ${abacCheck ? 'granted' : 'denied'} for rule:`, printRule(rule));
            }
            if (abacCheck) return true;
            continue;
          }

          if (options.enableLogging) {
            console.log('Access granted for rule:', printRule(rule));
          }
          return true;
        }
      }
    }
    if (options.enableLogging) {
      console.log('Access denied: No matching rule found');
    }
    return false; // No matching route found, access denied
  };
};
