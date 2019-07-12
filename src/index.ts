import Koa from 'koa';
import bodyParser from 'koa-body';

import { config } from './config';
import { logger } from './logging';
import { routes } from './routes';

const app = new Koa();

app.use(bodyParser());
app.use(logger);
app.use(routes);

app.listen(config.port);

console.log(`Server running on port ${config.port}.`);
