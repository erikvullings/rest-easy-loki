import fs from 'fs';
import path from 'path';
import loki, { Collection } from 'lokijs';
import lfsa from 'lokijs/src/loki-fs-structured-adapter';
import { ILokiConfiguration } from './models';

export type DatabaseLifecycleState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface DatabaseLifecycleOptions extends ILokiConfiguration {
  /** Database shell filename. Structured collection partitions use the same prefix. */
  file?: string;
  /** Delete an existing database before the first startup. */
  rebuild?: boolean;
}

export interface DatabaseLifecycle {
  readonly state: DatabaseLifecycleState;
  start(): Promise<void>;
  ready(): Promise<void>;
  shutdown(): Promise<void>;
  rebuild(): Promise<void>;
  collections(): Array<{ name: string; entries: number }>;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class LokiDatabaseLifecycle implements DatabaseLifecycle {
  public state: DatabaseLifecycleState = 'idle';
  private readonly file: string;
  private readonly options: DatabaseLifecycleOptions;
  private readonly collectionStore = new Map<string, Collection>();
  private database?: loki;
  private startup?: Promise<void>;
  private shutdownRequested = false;
  private rebuildOnStart: boolean;

  public constructor(options: DatabaseLifecycleOptions = {}) {
    this.options = options;
    this.file = path.resolve(options.file || 'rest_easy_loki.db');
    this.rebuildOnStart = options.rebuild === true;
  }

  public start(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve();
    }
    if (this.state === 'starting' && this.startup) {
      return this.startup;
    }

    this.shutdownRequested = false;
    this.state = 'starting';
    this.startup = this.startInternal();
    return this.startup;
  }

  public ready(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve();
    }
    if (!this.startup) {
      return Promise.reject(new Error('Database startup has not been started.'));
    }
    return this.startup;
  }

  public async shutdown(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.state = 'stopped';
      return;
    }
    if (this.state === 'starting' && this.startup) {
      this.shutdownRequested = true;
      await this.startup.catch(() => undefined);
      this.state = 'stopped';
      return;
    }
    if (!this.database) {
      this.state = 'stopped';
      return;
    }

    this.state = 'stopping';
    const database = this.database;
    database.autosaveDisable();
    await this.save(database, 'shutdown');
    await new Promise<void>((resolve, reject) => {
      database.close((error) => {
        if (error) {
          reject(new Error(`Failed to close database '${this.file}': ${errorMessage(error)}`));
        } else {
          resolve();
        }
      });
    });
    this.database = undefined;
    this.collectionStore.clear();
    this.startup = undefined;
    this.state = 'stopped';
  }

  public async rebuild(): Promise<void> {
    await this.shutdown();
    await this.deleteDatabaseFiles();
    this.rebuildOnStart = false;
    this.state = 'idle';
    await this.start();
  }

  public collections() {
    return Array.from(this.collectionStore.values()).map((collection) => ({
      name: collection.name,
      entries: collection.count(),
    }));
  }

  public collection(name: string): Collection | undefined {
    return this.collectionStore.get(name);
  }

  public createCollection(
    name: string,
    options: Partial<CollectionOptions<Record<string, unknown>>> = {},
  ): Collection {
    const database = this.requireDatabase();
    const collection = database.addCollection(name, options);
    this.collectionStore.set(name, collection);
    return collection;
  }

  public async persist(operation: string): Promise<void> {
    await this.save(this.requireDatabase(), operation);
  }

  private async startInternal(): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      if (this.rebuildOnStart) {
        await this.deleteDatabaseFiles();
        this.rebuildOnStart = false;
      }

      const database = new loki(this.file, {
        adapter: new lfsa(),
        autosave: false,
        throttledSaves: this.options.throttledSaves ?? true,
      } as Partial<LokiConfigOptions>);
      this.database = database;

      if (await this.shouldLoadExistingDatabase()) {
        await new Promise<void>((resolve, reject) => {
          database.loadDatabase({}, (error) => {
            if (error) {
              reject(new Error(`Failed to open database '${this.file}': ${errorMessage(error)}`));
            } else {
              resolve();
            }
          });
        });
      }
      this.throwIfInterrupted();

      database.collections.forEach((collection) => this.collectionStore.set(collection.name, collection));
      await this.createConfiguredCollections();
      this.throwIfInterrupted();
      await this.save(database, 'startup');
      this.throwIfInterrupted();

      database.autosaveEnable();
      this.state = 'ready';
    } catch (error) {
      this.database?.autosaveDisable();
      this.database = undefined;
      this.collectionStore.clear();
      this.state = 'failed';
      throw error;
    }
  }

  private async createConfiguredCollections(): Promise<void> {
    for (const [name, configuredOptions] of Object.entries(this.options.collections || {})) {
      if (this.collectionStore.has(name)) {
        continue;
      }

      const { jsonImport, ...collectionOptions } = configuredOptions;
      let collection: Collection;
      try {
        collection = this.createCollection(name, collectionOptions);
      } catch (error) {
        throw new Error(`Failed to create collection '${name}': ${errorMessage(error)}`);
      }

      if (jsonImport) {
        await this.importJson(collection, jsonImport);
      }
      this.throwIfInterrupted();
    }
  }

  private async shouldLoadExistingDatabase(): Promise<boolean> {
    if (!fs.existsSync(this.file)) {
      return false;
    }
    try {
      const shell = JSON.parse(await fs.promises.readFile(this.file, 'utf8')) as { collections?: unknown[] };
      return !Array.isArray(shell.collections) || shell.collections.length > 0;
    } catch {
      // Let Loki surface malformed or unreadable database errors with its normal load context.
      return true;
    }
  }

  private async importJson(collection: Collection, filename: string): Promise<void> {
    let data: string;
    try {
      data = await fs.promises.readFile(filename, 'utf8');
    } catch (error) {
      throw new Error(`Failed to import collection '${collection.name}' from '${filename}': ${errorMessage(error)}`);
    }

    let records: unknown;
    try {
      records = JSON.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON import for collection '${collection.name}' from '${filename}': ${errorMessage(error)}`,
      );
    }
    if (!Array.isArray(records)) {
      throw new Error(`JSON import for collection '${collection.name}' from '${filename}' must contain an array.`);
    }

    try {
      collection.insert(records);
    } catch (error) {
      throw new Error(
        `Failed to insert JSON import into collection '${collection.name}' from '${filename}': ${errorMessage(error)}`,
      );
    }
  }

  private async save(database: loki, phase: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      database.saveDatabase((error) => {
        if (error) {
          reject(new Error(`Failed to persist database '${this.file}' during ${phase}: ${errorMessage(error)}`));
        } else {
          resolve();
        }
      });
    });
  }

  private async deleteDatabaseFiles(): Promise<void> {
    const directory = path.dirname(this.file);
    const basename = path.basename(this.file);
    let files: string[];
    try {
      files = await fs.promises.readdir(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw new Error(`Failed to inspect database files for '${this.file}': ${errorMessage(error)}`);
    }
    const databaseFiles = files.filter((filename) => filename === basename || filename.startsWith(`${basename}.`));
    try {
      await Promise.all(databaseFiles.map((filename) => fs.promises.unlink(path.join(directory, filename))));
    } catch (error) {
      throw new Error(`Failed to rebuild database '${this.file}': ${errorMessage(error)}`);
    }
  }

  private requireDatabase(): loki {
    if (!this.database) {
      throw new Error('Database has not been started.');
    }
    return this.database;
  }

  private throwIfInterrupted() {
    if (this.shutdownRequested) {
      throw new Error(`Database startup for '${this.file}' was interrupted by shutdown.`);
    }
  }
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => error instanceof Error && 'code' in error;

export const createDatabaseLifecycle = (options: DatabaseLifecycleOptions = {}): DatabaseLifecycle =>
  new LokiDatabaseLifecycle(options);
