import http from 'http';
import * as Koa from 'koa';
import { Server } from 'socket.io';

export const createSocketService: (api: Koa) => { io: Server; server: http.Server } = (api: Koa) => {
  console.log('Enabled SOCKET.IO: subscribe to COLLECTION or COLLECTION/:ID to receive update notifications.');
  const server = http.createServer(api.callback());
  // const options = cors ? { origins: '*:*'} : undefined;
  // console.table(options);
  // const io = IO(server, options);
  const io = new Server(server);
  io.on('connection', (client) => {
    console.info('Client connected: ' + client.id);
    client.on('event', (data: any) => {
      console.log(data);
    });
    // client.on('disconnect', () => { /* … */ });
  });
  return { io, server };
};
