import fs from 'fs';
import { ApplicationLifecycle, createApplication } from './application-lifecycle';
import { config } from './config';
import { ILokiConfiguration } from './models';
import { ICommandOptions } from './models/command-options';

export const startService = async (configuration: ICommandOptions = config): Promise<ApplicationLifecycle> => {
  const dbOptions =
    configuration.config && fs.existsSync(configuration.config)
      ? (JSON.parse(fs.readFileSync(configuration.config).toString()) as ILokiConfiguration)
      : undefined;
  const application = createApplication({ configuration, database: dbOptions });
  await application.start();
  console.log(`Server running on port ${application.port}.`);
  return application;
};
