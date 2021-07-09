const passThrough = /^LOKI_/;
const block = /^LOKI_AUTHZ_/;

/** Convert environment variables to certain primitive types */
const converter = (v: any): undefined | string | boolean | number | Array<string | number | boolean> => {
  if (typeof v === 'undefined') {
    return v;
  }
  if (!isNaN(+v)) {
    return +v;
  }
  if (/true/i.test(v)) {
    return true;
  }
  if (/false/i.test(v)) {
    return false;
  }
  if (typeof v === 'string' && v.indexOf(',') > 0) {
    return v
      .split(',')
      .filter((x) => typeof x !== 'undefined')
      .map((x) => x.trim())
      .map((x) => converter(x) as string | number | boolean);
  }
  return v;
};

/**
 * Retrieve the environment variables that start with LOKI_ and serve them.
 * Since every environment variable will be a string, also try to convert
 * true and false to booleans, numbers to numbers, and comma separted strings
 * to string arrays.
 * Other environment variables may contain secrets, so do not serve them.
 */
export const environment = () => {
  const { env } = process;
  return Object.keys(env).reduce((acc, cur) => {
    if (!block.test(cur) && passThrough.test(cur)) {
      acc[cur] = converter(env[cur]);
    }
    return acc;
  }, {} as { [key: string]: undefined | string | number | boolean | Array<number | string | boolean> });
};
