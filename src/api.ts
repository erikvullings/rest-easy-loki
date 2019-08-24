// tslint:disable-next-line: no-var-requires
const cors = require('@koa/cors');
import Koa from 'koa';
import bodyParser from 'koa-body';
import serve from 'koa-static';
import { logger, setLoggingOptions } from './logging';
import { ICommandOptions } from './models/command-options';
import { router } from './routes';

const state = {
  verbose: false,
  port: 3000,
  cors: false,
} as ICommandOptions;

export const createApi = (options: Partial<ICommandOptions>): Koa => {
  if (options.verbose) {
    state.verbose = options.verbose;
    setLoggingOptions(state.verbose);
  }
  if (options.port) {
    state.port = options.port;
  }
  const api: Koa = new Koa();

  if (options.cors) {
    console.log('Enabling CORS.');
    api.use(cors());
  }
  api.use(bodyParser());
  api.use(logger);
  api.use(serve('./public'));
  api.use(router.routes());
  api.use(router.allowedMethods());
  return api;
};
