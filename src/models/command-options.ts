export interface ICommandOptions {
  /** Show the manual */
  help: boolean;
  /** Show verbose output */
  pretty: boolean;
  /** Port to use */
  port: number;
  /** Enable CORS */
  cors: boolean;
  /** Database name */
  db: string;
  /** Message size limit for URL-encoded or JSON messages. Used in bodyparser, e.g. 1mb. Default 25mb */
  sizeLimit: string;
}
