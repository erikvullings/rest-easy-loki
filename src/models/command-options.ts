export interface ICommandOptions {
  /** Show the manual */
  help?: boolean;
  /** Show verbose output */
  pretty?: boolean;
  /** Port to use */
  port?: number;
  /** Enable CORS */
  cors?: boolean;
  /** Enable Socket.io */
  io?: boolean;
  /** Static public folder name, default 'public' */
  public?: string;
  /** Allow file uploads to upload folder, default not activated */
  upload?: string;
  /** Database name */
  db?: string;
  /** Message size limit for URL-encoded or JSON messages. Used in bodyparser, e.g. 1mb. Default 25mb */
  sizeLimit?: string;
  /** Read the configuration file to configure the database */
  config?: string;
  /** Read the policies file to configure route-based access control */
  policies?: string;
  /** If true, use zip compression for the messages */
  compression?: boolean;
  /** If true, aggresively print debug info */
  debug?: boolean;
}
