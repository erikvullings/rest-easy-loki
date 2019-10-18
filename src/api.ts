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

export const createApi = (config: Partial<ICommandOptions>): Koa => {
  if (config.verbose) {
    state.verbose = config.verbose;
    setLoggingOptions(state.verbose);
  }
  if (config.port) {
    state.port = config.port;
  }
  const api: Koa = new Koa();

  if (config.cors) {
    console.log('Enabling CORS.');
    api.use(cors());
  }
  api.use(bodyParser({formLimit: config.sizeLimit, jsonLimit: config.sizeLimit }));
  api.use(logger);
  api.use(serve('./public'));
  api.use(router.routes());
  api.use(router.allowedMethods());
  return api;
};
