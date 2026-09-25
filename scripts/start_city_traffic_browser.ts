import { startServer } from '../server.js';

const port = Number(process.env.PORT ?? 3737);
void startServer(() => ({ currentPage: 'city_traffic' }), () => undefined, undefined, port)
  .then(() => console.log(`City Traffic browser mode: http://localhost:${port}/city_traffic.html`));
