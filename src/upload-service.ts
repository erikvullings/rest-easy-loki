import * as fs from 'fs';
import Koa from 'koa';
import { File } from 'formidable';
import { join } from 'path';

export const uploadService =
  (uploadPath: string) =>
  async (ctx: Koa.Context, next: () => Promise<any>): Promise<void> => {
    if (ctx.method !== 'POST' || !/^\/upload\//.test(ctx.path)) {
      return await next();
    }
    return new Promise((resolve, reject) => {
      const context = ctx.path.replace('/upload/', '');
      if (!context) {
        ctx.throw(400, "Missing context! Please use '/upload/:CONTEXT'."); // bad request
      }
      const tmpdir = join(uploadPath, context);
      const baseUrl = `/${context}/`;
      fs.mkdir(tmpdir, { recursive: true }, (err) => {
        if (err && err.code !== 'EEXIST') {
          const errMsg = `Error creating directory ${tmpdir}! Error: ${err.code} - ${err.message}.`;
          reject('Error creating directory');
          ctx.throw(500, errMsg); // bad request
        }
        if (ctx && ctx.request && ctx.request.files) {
          const filePaths = [] as string[];
          const files = ctx.request.files || {};
          for (const key in files) {
            if (!files.hasOwnProperty(key)) {
              continue;
            }
            const file = files[key] as File;
            const filename = file.originalFilename || file.newFilename;
            const filePath = join(tmpdir, filename);
            const reader = fs.createReadStream(file.filepath);
            const stream = fs.createWriteStream(filePath);
            reader.pipe(stream);
            filePaths.push(baseUrl + filename);
            console.log('Uploading %s -> %s', filename, stream.path);
          }
          ctx.body = filePaths;
          resolve();
        }
      });
    });
  };
