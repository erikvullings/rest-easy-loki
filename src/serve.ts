// import http from 'http';
// import IO from 'socket.io';
import { config } from './config';
import { createApi, db } from './index';
import { ICommandOptions } from './models/command-options';

export const startService = (configuration: ICommandOptions = config) => {
  db.startDatabase(configuration.db, () => {
    const { api, server } = createApi(configuration);
    (server || api).listen(configuration.port);
    console.log(`Server running on port ${configuration.port}.`);
  });
};
