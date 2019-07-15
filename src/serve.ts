import { config } from './config';
import { api, db } from './index';

db.startDatabase('rest_easy_loki.db', () => {
  api.listen(config.port);
  console.log(`Server running on port ${config.port}.`);
});
