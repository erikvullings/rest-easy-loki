/** Creates a pagination filter */
export const paginationFilter = ({ from, to }: { from?: string; to?: string }) => {
  if (!from && !to) {
    return undefined;
  }
  const f = from ? +from : 0;
  const t = to ? +to : Number.MAX_SAFE_INTEGER;
  return (_: any, index: number) => f <= index && index <= t;
};

/** Sort descending by updated date (when updated is not available, use created date) */
export const sortByDateDesc = (obj1: LokiObj, obj2: LokiObj) => {
  const time1 = obj1.meta.updated || obj1.meta.created;
  const time2 = obj2.meta.updated || obj2.meta.created;
  return time1 === time2 ? 0 : time1 > time2 ? -1 : 1;
};

// export const queryFilter = (query: { [prop: string]: string | number | { [ops: string]: string | number}}) => {

// };
