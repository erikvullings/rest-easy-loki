import * as fs from 'fs';
import Koa from 'koa';
import * as path from 'path';

export const uploadService = (uploadPath: string) => async (
  ctx: Koa.Context,
  next: () => Promise<any>,
): Promise<void> => {
  if (ctx.method !== 'POST' || !/^\/upload\//.test(ctx.path)) {
    return await next();
  }
  return new Promise((resolve, reject) => {
    const context = ctx.path.replace('/upload/', '');
    if (!context) {
      ctx.throw(400, "Missing context! Please use '/upload/:CONTEXT'."); // bad request
    }
    const tmpdir = path.join(uploadPath, context);
    const baseUrl = `/${context}/`;
    fs.mkdir(tmpdir, { recursive: true }, (err) => {
      if (err && err.code !== 'EEXIST') {
        const errMsg = `Error creating directory ${tmpdir}! Error: ${err.code} - ${err.message}.`;
        reject('Error creating directory');
        ctx.throw(500, errMsg); // bad request
      }
      if (ctx && ctx.request && (ctx.request as any).files) {
        const filePaths = [] as string[];
        const files = (ctx.request as any).files || {};
        for (const key in files) {
          if (!files.hasOwnProperty(key)) {
            continue;
          }
          const file = files[key];
          const filePath = path.join(tmpdir, file.name);
          const reader = fs.createReadStream(file.path);
          const stream = fs.createWriteStream(filePath);
          reader.pipe(stream);
          filePaths.push(baseUrl + file.name);
          console.log('Uploading %s -> %s', file.name, stream.path);
        }
        ctx.body = filePaths;
        resolve();
      }
    });
  });
};
