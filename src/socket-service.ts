import http from 'http';
import * as Koa from 'koa';
import IO from 'socket.io';

export const createSocketService = (api: Koa) => {
  console.log('Enabling SOCKET.IO: subscribe to COLLECTION or COLLECTION/:ID to receive update notifications.');
  const server = http.createServer(api.callback());
  // const options = cors ? { origins: '*:*'} : undefined;
  // console.table(options);
  // const io = IO(server, options);
  const io = IO(server);
  io.on('connection', client => {
    console.info('Client connected: ' + client.id);
    client.on('event', data => { console.log(data); });
    // client.on('disconnect', () => { /* … */ });
  });
  return { io, server};
};
