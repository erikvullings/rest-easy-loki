import http from 'http';
import type { AddressInfo } from 'net';
import type Koa from 'koa';
import type Router from 'koa-router';
import type { Server as SocketServer } from 'socket.io';
import { createApi } from './api';
import { CollectionAccess, createCollectionAccess } from './collection-access';
import { validateConfiguration, ValidatedConfiguration } from './configuration';
import { createDatabaseLifecycle, DatabaseLifecycle } from './database-lifecycle';
import { ICommandOptions, ILokiConfiguration, Resolver } from './models';

export type ApplicationLifecycleState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface ApplicationOptions {
  configuration: ICommandOptions;
  database?: ILokiConfiguration;
  router?: Router;
  resolve?: Resolver;
  host?: string;
}

export interface ApplicationLifecycle {
  readonly state: ApplicationLifecycleState;
  readonly port: number;
  readonly api: Koa | undefined;
  readonly collections: CollectionAccess | undefined;
  start(): Promise<void>;
  ready(): Promise<void>;
  shutdown(): Promise<void>;
}

class LokiApplicationLifecycle implements ApplicationLifecycle {
  public state: ApplicationLifecycleState = 'idle';
  public port = 0;
  public api: Koa | undefined;
  public collections: CollectionAccess | undefined;
  private database: DatabaseLifecycle | undefined;
  private listener: http.Server | undefined;
  private socket: SocketServer | undefined;
  private configuration: ValidatedConfiguration | undefined;
  private startup: Promise<void> | undefined;
  private shutdownRequested = false;

  public constructor(private readonly options: ApplicationOptions) {}

  public start(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve();
    }
    if (this.state === 'starting' && this.startup) {
      return this.startup;
    }
    try {
      this.configuration = validateConfiguration(this.options.configuration);
    } catch (error) {
      this.state = 'failed';
      return Promise.reject(error);
    }
    this.state = 'starting';
    this.shutdownRequested = false;
    this.startup = this.startInternal();
    return this.startup;
  }

  public ready(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve();
    }
    return this.startup || Promise.reject(new Error('Application startup has not been started.'));
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

    this.state = 'stopping';
    await this.closeListener();
    await this.database?.shutdown();
    this.clearResources();
    this.state = 'stopped';
  }

  private async startInternal(): Promise<void> {
    try {
      const configuration = this.configuration;
      if (!configuration) {
        throw new Error('Application configuration was not validated.');
      }
      this.database = createDatabaseLifecycle({
        ...this.options.database,
        file: configuration.db,
      });
      await this.database.start();
      this.throwIfInterrupted();

      this.collections = createCollectionAccess(this.database);
      const assembled = createApi(
        configuration,
        this.options.router,
        this.options.resolve,
        this.collections,
      );
      this.api = assembled.api;
      this.socket = assembled.io;
      this.listener = assembled.server || http.createServer(assembled.api.callback());
      await this.listen(this.listener, configuration.port);
      this.throwIfInterrupted();
      this.state = 'ready';
    } catch (error) {
      const cleanupError = await this.cleanupAfterFailure();
      this.state = 'failed';
      if (cleanupError) {
        throw new Error(`${errorMessage(error)} Cleanup also failed: ${errorMessage(cleanupError)}`);
      }
      throw error;
    }
  }

  private listen(server: http.Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Application listener did not provide a TCP address.'));
          return;
        }
        this.port = (address as AddressInfo).port;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, this.options.host);
    });
  }

  private async closeListener(): Promise<void> {
    const listener = this.listener;
    if (!listener) {
      return;
    }
    if (this.socket) {
      await new Promise<void>((resolve) => this.socket?.close(() => resolve()));
    } else if (listener.listening) {
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      });
    }
    this.listener = undefined;
    this.socket = undefined;
  }

  private async cleanupAfterFailure(): Promise<unknown> {
    try {
      await this.closeListener();
      await this.database?.shutdown();
      this.clearResources();
      return undefined;
    } catch (error) {
      this.clearResources();
      return error;
    }
  }

  private clearResources() {
    this.listener = undefined;
    this.socket = undefined;
    this.database = undefined;
    this.collections = undefined;
    this.api = undefined;
    this.configuration = undefined;
    this.startup = undefined;
    this.port = 0;
  }

  private throwIfInterrupted() {
    if (this.shutdownRequested) {
      throw new Error('Application startup was interrupted by shutdown.');
    }
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const createApplication = (options: ApplicationOptions): ApplicationLifecycle =>
  new LokiApplicationLifecycle(options);
