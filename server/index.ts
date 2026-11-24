import { buildApp } from './app';

const port = Number(process.env.PORT ?? 8791);
const host = process.env.HOST ?? 'localhost';
const llmEndpoint = process.env.LLM_ENDPOINT;

const app = buildApp({
  dataFile: process.env.DATA_FILE ?? 'data/drafts.json',
  staticDir: process.env.STATIC_DIR ?? 'dist',
  suggestDelayMs: Number(process.env.SUGGEST_DELAY_MS ?? 90),
  llm: llmEndpoint ? { endpoint: llmEndpoint, model: process.env.LLM_MODEL ?? 'default' } : undefined,
});

app
  .listen({ port, host })
  .then(() => console.log(`Claim editor API listening on http://${host}:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const stop = () => void app.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
