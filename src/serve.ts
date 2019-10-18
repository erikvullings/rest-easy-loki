import { config } from './config';
import { createApi, db } from './index';
import { ICommandOptions } from './models/command-options';

export const startService = (configuration: ICommandOptions = config) => {
  db.startDatabase(configuration.db, () => {
    const api = createApi(configuration);
    api.listen(configuration.port);
    console.log(`Server running on port ${configuration.port}.`);
  });
};
