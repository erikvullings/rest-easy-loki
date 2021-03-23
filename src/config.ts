import dotenv from 'dotenv';
import { ICommandOptions } from './models/command-options';

dotenv.config();

export const config = {
  help: false,
  /** Public folder to expose */
  public: process.env.LOKI_PUBLIC || './public',
  /** Pretty print logs */
  pretty: typeof process.env.LOKI_CORS !== 'undefined' ? process.env.LOKI_PRETTY : true,
  /** Define port to use */
  port: process.env.LOKI_PORT || 3000,
  /** Allow CORS */
  cors: typeof process.env.LOKI_CORS !== 'undefined' ? process.env.LOKI_CORS : true,
  /** Enable socket.io */
  io: typeof process.env.LOKI_IO !== 'undefined' ? process.env.LOKI_IO : true,
  /** Name of the database file in the DB folder */
  db: process.env.LOKI_DB || 'rest_easy_loki.db',
  /** Size limit of the database */
  sizeLimit: process.env.LOKI_SIZE_LIMIT || '250mb',
  /** Read the configuration file to configure the database */
  config: process.env.LOKI_CONFIG,
  /** Use compression */
  compression: typeof process.env.LOKI_COMPRESSION !== 'undefined' ? process.env.LOKI_COMPRESSION : true,
} as ICommandOptions;
