const cors = require('@koa/cors');
import * as fs from 'fs';
import * as http from 'http';
import * as zlib from 'zlib';
import Koa from 'koa';
import koaBody from 'koa-body';
import serve from 'koa-static';
import compress from 'koa-compress';
import Router from 'koa-router';
import * as path from 'path';
import { pep } from './authorization';
import { logger, setLoggingOptions } from './logging';
import { ICommandOptions, Resolver } from './models';
import { createRouter } from './routes';
import { createSocketService } from './socket-service';
import { uploadService } from './upload-service';

/** Create the API, optionally injecting your own routes */
export const createApi = (
  config: ICommandOptions,
  router?: Router,
  resolve?: Resolver,
): { api: Koa; server?: http.Server } => {
  setLoggingOptions(config.pretty as boolean);
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

  if (config.compression) {
    console.log('Enabled compression with koa-compress.');
    // api.use(cors({ credentials: true }));
    api.use(
      compress({
        br: {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 3,
          },
        },
      }),
    );
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
    const publicPath = path.resolve(process.cwd(), config.public);
    console.log('Enabled serving files from ' + publicPath);
    api.use(serve(publicPath));
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
  if (router) {
    api.use(router.routes());
    api.use(router.allowedMethods());
  }
  const dbRouter = createRouter(ss ? ss.io : undefined, resolve);
  api.use(dbRouter.routes());
  api.use(dbRouter.allowedMethods());
  return { api, server: ss ? ss.server : undefined };
};
