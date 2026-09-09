/** Sort descending by updated date (when updated is not available, use created date) */
export const sortByDateDesc = (obj1: LokiObj, obj2: LokiObj) => {
  if (!obj1.meta || !obj2.meta) return 0;
  const time1 = obj1.meta.updated || obj1.meta.created;
  const time2 = obj2.meta.updated || obj2.meta.created;
  return time1 === time2 ? 0 : time1 > time2 ? -1 : 1;
};
