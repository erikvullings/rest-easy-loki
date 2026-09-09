const passThrough = /^LOKI_/;
const block = /^LOKI_AUTHZ_/;

/** Convert environment variables to certain primitive types */
const converter = (v: string | undefined): EnvironmentValue => {
  if (typeof v === 'undefined') {
    return v;
  }
  if (!isNaN(+v)) {
    return +v;
  }
  if (/^true$/i.test(v)) {
    return true;
  }
  if (/^false$/i.test(v)) {
    return false;
  }
  if (v.indexOf(',') >= 0) {
    return v
      .split(',')
      .filter((x) => typeof x !== 'undefined')
      .map((x) => x.trim())
      .map((x) => converter(x) as string | number | boolean);
  }
  return v;
};

/**
 * Map source values that start with LOKI_ for the public environment route.
 * Since every environment value will be a string, also try to convert
 * true and false to booleans, numbers to numbers, and comma separted strings
 * to string arrays.
 * Other environment variables may contain secrets, so do not serve them.
 */
export const environment = (source: Readonly<Record<string, string | undefined>>) => {
  return Object.keys(source).reduce((acc, cur) => {
    if (!block.test(cur) && passThrough.test(cur)) {
      acc[cur] = converter(source[cur]);
    }
    return acc;
  }, {} as Record<string, EnvironmentValue>);
};
import type { EnvironmentValue } from './models';
