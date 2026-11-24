import { buildApp } from '../server/app';

const port = 4391;
const app = buildApp({ dataFile: null, staticDir: 'dist', suggestDelayMs: 60 });
await app.listen({ port, host: 'localhost' });
console.log(`e2e server on ${port}`);
