#! /usr/bin/env node

var { startService } = require('../dist/serve.js');
startService({
  port: process.env.LOKI_PORT || 3000,
  cors: true,
  db: process.env.LOKI_DB || 'rest_easy_loki.db'
});
