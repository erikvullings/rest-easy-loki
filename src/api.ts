// tslint:disable-next-line: no-var-requires
const cors = require('@koa/cors');
import * as fs from 'fs';
import * as http from 'http';
import Koa from 'koa';
import koaBody from 'koa-body';
import serve from 'koa-static';
import * as path from 'path';
import { pep } from './authorization';
import { logger, setLoggingOptions } from './logging';
import { ICommandOptions } from './models/command-options';
import { createRouter } from './routes';
import { createSocketService } from './socket-service';
import { uploadService } from './upload-service';

const state = {
  pretty: false,
  port: 3000,
  cors: false,
} as ICommandOptions;

export const createApi = (config: ICommandOptions): { api: Koa, server?: http.Server } => {
  if (config.pretty) {
    state.pretty = config.pretty;
  }
  setLoggingOptions(state.pretty as boolean);
  if (config.port) {
    state.port = config.port;
  }
  const api: Koa = new Koa();

  // custom 404
  // api.use(async (ctx, next) => {
  //   await next();
  //   if (ctx.body || !ctx.idempotent) {
  //     return;
  //   }
  //   ctx.redirect('/404.html');
  // });

  if (config.cors) {
    console.log('Enabled CORS.');
    // api.use(cors({ credentials: true }));
    api.use(cors());
  }

  const ss = config.io ? createSocketService(api) : undefined;

  api.use(
    koaBody({
      formLimit: config.sizeLimit,
      jsonLimit: config.sizeLimit,
      multipart: true,
    }),
  );
  api.use(logger);
  // Serve public folder
  if (config.public) {
    api.use(serve(path.resolve(process.cwd(), config.public)));
  }
  api.use(pep);
  // Allow uploading files to 'config.upload' folder. Files can be uploaded to /upload/:CONTEXT.
  if (config.upload) {
    const uploadPath = path.resolve(process.cwd(), config.upload);
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    api.use(serve(uploadPath));
    api.use(uploadService(uploadPath));
    console.log(`Enabled file uploads: POST to /upload/:CONTEXT and the files will be saved in ${uploadPath}.`);
  }
  const router = createRouter(ss ? ss.io : undefined);
  api.use(router.routes());
  api.use(router.allowedMethods());
  return { api, server: ss ? ss.server : undefined };
};
