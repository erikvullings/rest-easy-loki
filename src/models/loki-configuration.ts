/** From LokiJS typings, but not exported */
export interface CollectionOptions<E> {
  disableMeta: boolean;
  disableChangesApi: boolean;
  disableDeltaChangesApi: boolean;
  adaptiveBinaryIndices: boolean;
  asyncListeners: boolean;
  autoupdate: boolean;
  clone: boolean;
  cloneMethod: 'parse-stringify' | 'jquery-extend-deep' | 'shallow' | 'shallow-assign' | 'shallow-recurse-objects';
  serializableIndices: boolean;
  transactional: boolean;
  ttl: number;
  ttlInterval: number;
  exact: (keyof E)[];
  unique: (keyof E)[];
  indices: keyof E | (keyof E)[];
}

export interface ExtendedCollectionOptions<E> extends CollectionOptions<E> {
  /** JSON file to import: expects a JSON array which will be inserted into the collection */
  jsonImport?: string;
}

export interface ILokiConfiguration<T = {}> {
  throttledSaves?: boolean;
  /** Create collections on startup if there are no collections yet */
  collections?: {
    /** Name of the collection */
    [collectionName: string]: ExtendedCollectionOptions<T>;
  };
}
