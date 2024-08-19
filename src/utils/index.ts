import { existsSync, readFileSync } from 'fs';
import { PolicyRule } from '../route-based-access-control';

/** Creates a pagination filter */
export const paginationFilter = ({ from, to }: { from?: string; to?: string }) => {
  if (!from && !to) {
    return undefined;
  }
  const f = from ? +from : 0;
  const t = to ? +to : Number.MAX_SAFE_INTEGER;
  return (_: any, index: number) => f <= index && index <= t;
};

/** Creates a property map, i.e. it will only return a subset of all data  */
export const propertyMap = ({ props }: { props?: string }) => {
  if (!props) {
    return undefined;
  }
  const p = props.split(',').map((prop) => prop.trim());
  return (cur: { [key: string]: any }) => {
    const obj = {} as { [key: string]: any };
    p.filter((prop) => cur.hasOwnProperty(prop)).forEach((prop) => (obj[prop] = cur[prop]));
    return obj;
  };
};

/** Sort descending by updated date (when updated is not available, use created date) */
export const sortByDateDesc = (obj1: LokiObj, obj2: LokiObj) => {
  const time1 = obj1.meta.updated || obj1.meta.created;
  const time2 = obj2.meta.updated || obj2.meta.created;
  return time1 === time2 ? 0 : time1 > time2 ? -1 : 1;
};

/** Read the policies from file, if any */
export const readPolicies = (filePath?: string): PolicyRule[] => {
  if (!filePath) return [];
  try {
    if (!existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return []; // Return an empty array if the file doesn't exist.
    }

    const fileContent = readFileSync(filePath, 'utf-8');

    const parsedData = JSON.parse(fileContent);

    if (parsedData.rules && Array.isArray(parsedData.rules)) {
      return parsedData.rules; // Return the parsed array if it's valid.
    } else {
      console.warn(`Invalid JSON: Expected an array in ${filePath}`);
      return []; // Return an empty array if the JSON is not an array.
    }
  } catch (error: any) {
    console.error(`Error reading or parsing ${filePath}:`, error.message);
    return []; // Return an empty array if an error occurs (e.g., invalid JSON).
  }
};
