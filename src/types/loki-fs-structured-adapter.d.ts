/**
 * A loki persistence adapter which persists using node fs module
 * @constructor LokiFsAdapter
 */
declare class LokiFsStructuredAdapter implements LokiPersistenceAdapter {
  constructor();

  /**
   * loadDatabase() - Load data from file, will throw an error if the file does not exist
   * @param dbname - the filename of the database to load
   * @param callback - the callback to handle the result
   */
  public loadDatabase(dbname: string, callback: (data: any | Error) => void): void;

  /**
   * saveDatabase() - save data to file, will throw an error if the file can't be saved
   * might want to expand this to avoid dataloss on partial save
   * @param dbname - the filename of the database to load
   * @param callback - the callback to handle the result
   */
  public saveDatabase(dbname: string, dbstring: string | Uint8Array, callback: (err?: Error | null) => void): void;

  /**
   * deleteDatabase() - delete the database file, will throw an error if the
   * file can't be deleted
   * @param dbname - the filename of the database to delete
   * @param callback - the callback to handle the result
   */
  public deleteDatabase(dbname: string, callback: (err?: Error | null) => void): void;
}

declare class _LokiFsStructuredAdapter extends LokiFsStructuredAdapter {}

declare module LokiFsStructuredAdapterConstructor {
  export class LokiFsStructuredAdapter extends _LokiFsStructuredAdapter {}
}

declare module 'loki-fs-structured-adapter' {
  // const content: any;
  // export default content;
  export = LokiFsStructuredAdapterConstructor;
}
