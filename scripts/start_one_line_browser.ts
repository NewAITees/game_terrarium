import { startServer } from '../server.js';

const port = Number(process.env.PORT ?? 3000);
void startServer(() => ({ currentPage: 'one_line_rpg' }), () => undefined, undefined, port)
  .then(() => console.log(`One-Line RPG browser mode: http://localhost:${port}/one_line_rpg.html`));
