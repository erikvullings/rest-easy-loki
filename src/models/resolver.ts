/** Resolver function that can retrieve missing values in GET calls. */

export type Resolver = (options: {
  query?: string | string[];
  uniqueId?: '$loki' | string;
  id?: string | number;
}) => Promise<any | any[]>;
