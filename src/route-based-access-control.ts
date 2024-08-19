import { JWTPayload } from 'jose';

export interface PolicyRule {
  method: string;
  path: string;
  abac?: { [key: string]: any };
}

export interface AccessControlOptions {
  enableLogging?: boolean;
}

export type PolicyEvaluator = (method: string, path: string, jwtPayload: JWTPayload) => boolean;

export const createRouteBasedAccessControl = (policyFile?: PolicyRule[], options: AccessControlOptions = {}) => {
  interface CompiledRule extends PolicyRule {
    regex: RegExp;
    placeholders: string[];
  }

  const policy: CompiledRule[] = (policyFile || []).map((rule) => {
    const placeholders: string[] = [];
    // const regexPath = encodeURIComponent(rule.path)
    const regexPath = rule.path.replace(/\*/g, '.*').replace(/:([^%]+)/g, (_, placeholder) => {
      placeholders.push(placeholder);
      return '([^/]+)';
    });
    return {
      ...rule,
      regex: new RegExp(`^${regexPath}$`, 'i'),
      placeholders,
    };
  });

  const checkProperty = (jwtPayload: JWTPayload, key: string, value: any): boolean => {
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

  const printRule = ({ method, path, abac }: CompiledRule) => JSON.stringify({ method, path, abac });

  return (method: string, path: string, jwtPayload: JWTPayload): boolean => {
    // const encodedPath = encodeURIComponent(path);
    for (const rule of policy) {
      if (rule.method.toLowerCase() === method.toLowerCase()) {
        const match = path.match(rule.regex);
        // const match = encodedPath.match(rule.regex);
        if (match) {
          // Check placeholders
          const placeholderValues = match.slice(1);
          const placeholderCheck = rule.placeholders.every((placeholder, index) => {
            return checkProperty(jwtPayload, placeholder, decodeURIComponent(placeholderValues[index]));
          });

          if (!placeholderCheck) {
            if (options.enableLogging) {
              console.log('Access denied: Placeholder check failed for rule:', printRule(rule));
            }
            continue;
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
