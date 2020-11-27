import fs from 'fs';
import { config } from './config';
import { createApi, db } from './index';
import { ILokiConfiguration } from './models';
import { ICommandOptions } from './models/command-options';

export const startService = (configuration: ICommandOptions = config) => {
  const dbOptions =
    configuration.config && fs.existsSync(configuration.config)
      ? (JSON.parse(fs.readFileSync(configuration.config).toString()) as ILokiConfiguration)
      : undefined;
  db.startDatabase(
    configuration.db,
    () => {
      const { api, server } = createApi(configuration);
      (server || api).listen(configuration.port);
      console.log(`Server running on port ${configuration.port}.`);
    },
    dbOptions,
  );
};
