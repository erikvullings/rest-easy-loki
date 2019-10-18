import commandLineArgs from 'command-line-args';
import { OptionDefinition } from 'command-line-args';
import { ICommandOptions } from './models/command-options';
import { startService } from './serve';
import { config } from './config';

// tslint:disable-next-line: no-var-requires
const npm = require('../package.json') as {
  name: string;
  author: string;
  license: string;
  version: string;
  description: string;
  bin: { [key: string]: string };
};

const cmdName = Object.keys(npm.bin).shift();

/**
 * Adds missing properties from typings.
 */
export interface IFixedOptionDefinition extends OptionDefinition {
  description: string;
  typeLabel: string;
}

export class CommandLineInterface {
  public static optionDefinitions: IFixedOptionDefinition[] = [
    {
      name: 'help',
      alias: 'h',
      type: Boolean,
      typeLabel: 'Boolean',
      description: 'Show the help manual',
    },
    {
      name: 'cors',
      alias: 'c',
      type: Boolean,
      typeLabel: 'Boolean',
      defaultValue: config.cors,
      description: 'Enable CORS (default true)',
    },
    {
      name: 'pretty',
      alias: 'v',
      defaultValue: config.pretty,
      type: Boolean,
      typeLabel: 'Boolean',
      description: 'Enable pretty output, default taken from environment settings, $LOKI_PRETTY, default true.',
    },
    {
      name: 'port',
      alias: 'p',
      defaultValue: config.port,
      type: Boolean,
      typeLabel: 'Boolean',
      description: 'Port to use, default taken from environment settings, $LOKI_PORT, otherwise 3000',
    },
    {
      name: 'sizeLimit',
      alias: 's',
      defaultValue: config.sizeLimit,
      type: String,
      typeLabel: 'String',
      description: 'Message size limit for body parser, $LOKI_SIZE_LIMIT, default 25mb',
    },
    {
      name: 'db',
      alias: 'd',
      defaultValue: config.db,
      type: String,
      typeLabel: 'String',
      description: 'Name of the database taken from environment settings, $LOKI_DB, otherwise `rest_easy_loki.db`.',
    },
  ];

  public static sections = [
    {
      header: `${npm.name.toUpperCase()} (${npm.license} license, version ${npm.version})`,
      content: npm.description,
    },
    {
      header: 'Options',
      optionList: CommandLineInterface.optionDefinitions,
    },
    {
      header: 'Examples',
      content: [
        {
          desc: '01. Start the service on port 3000 using default settings',
          example: `$ ${cmdName}`,
        },
        {
          desc: '02. Start the service on port 3456, enabling CORS, and using verbose output.',
          example: `$ ${cmdName} -p 3456 -v -c`,
        },
      ],
    },
  ];
}

const options = commandLineArgs(CommandLineInterface.optionDefinitions) as ICommandOptions;
if (options.help) {
  // tslint:disable-next-line: no-var-requires
  const getUsage = require('command-line-usage');
  const usage = getUsage(CommandLineInterface.sections);
  console.log(usage);
  process.exit(0);
}

startService(options);
