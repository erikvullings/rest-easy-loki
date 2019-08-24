#! /usr/bin/env node

var { startService } = require('../dist/serve.js');
startService({ port: 3000, cors: true });
