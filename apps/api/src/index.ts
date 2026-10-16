import { buildApp } from './app.ts';
import { readConfig } from './config.ts';
import { createStore } from './store.ts';

const config = readConfig();
const store = await createStore(config);
const app = buildApp({ store, daytona: config.daytona });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  await app.close();
  throw error;
}
