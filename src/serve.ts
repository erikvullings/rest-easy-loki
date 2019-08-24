import { createApi, db } from './index';
import { ICommandOptions } from './models/command-options';

export const startService = (config: ICommandOptions) =>
  db.startDatabase('rest_easy_loki.db', () => {
    const api = createApi(config);
    api.listen(config.port);
    console.log(`Server running on port ${config.port}.`);
  });
