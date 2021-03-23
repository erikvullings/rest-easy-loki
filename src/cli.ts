import commandLineArgs from 'command-line-args';
import { OptionDefinition } from 'command-line-args';
import { config } from './config';
import { ICommandOptions } from './models/command-options';
import { startService } from './serve';

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
      description: 'Show the help manual.',
    },
    {
      name: 'cors',
      alias: 'c',
      type: Boolean,
      typeLabel: 'Boolean',
      defaultValue: config.cors,
      description: `Enable CORS ($LOKI_CORS ${config.cors}).`,
    },
    {
      name: 'compression',
      alias: 'z',
      type: Boolean,
      typeLabel: 'Boolean',
      defaultValue: config.compression,
      description: `Enable ZIP compression ($LOKI_COMPRESSION ${config.compression}).`,
    },
    {
      name: 'config',
      defaultValue: config.config,
      type: String,
      typeLabel: 'String',
      description: `Name of configuration file to configure the DB ($LOKI_CONFIG).`,
    },
    {
      name: 'io',
      alias: 'i',
      type: Boolean,
      typeLabel: 'Boolean',
      defaultValue: config.io,
      description: `Enable socket.io ($LOKI_IO ${config.io}).`,
    },
    {
      name: 'pretty',
      alias: 'v',
      defaultValue: config.pretty,
      type: Boolean,
      typeLabel: 'Boolean',
      description: `Enable pretty output ($LOKI_PRETTY ${config.pretty}).`,
    },
    {
      name: 'port',
      alias: 'p',
      defaultValue: config.port,
      type: Boolean,
      typeLabel: 'Boolean',
      description: `Port to use ($LOKI_PORT ${config.port}).`,
    },
    {
      name: 'sizeLimit',
      alias: 's',
      defaultValue: config.sizeLimit,
      type: String,
      typeLabel: 'String',
      description: `Message size limit for body parser ($LOKI_SIZE_LIMIT ${config.sizeLimit}).`,
    },
    {
      name: 'upload',
      alias: 'u',
      type: String,
      typeLabel: 'String',
      description: 'Optional relative path to the `upload` folder to upload files to `/upload/:CONTEXT` URL.',
    },
    {
      name: 'public',
      alias: 'b',
      defaultValue: 'public',
      type: String,
      typeLabel: 'String',
      description: "Relative path to a `public` folder to share your files, default 'public'.",
    },
    {
      name: 'db',
      alias: 'd',
      defaultValue: config.db,
      type: String,
      typeLabel: 'String',
      description: `Name of the database taken from environment settings ($LOKI_DB ${config.db}).`,
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
        {
          desc: '03. Start the service on port 3456, allowing uploading files to the upload folder.',
          example: `$ ${cmdName} -p 3456 -u ./upload`,
        },
        {
          desc: '04. Start the service and allow clients to subscribe to updates via socket.io.',
          example: `$ ${cmdName} -i`,
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
