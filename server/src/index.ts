import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const { app, deps } = await buildApp(env);

await deps.jobs.recoverOnStartup();
deps.jobs.startWatchdog();

await app.listen({ port: env.PORT, host: env.HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    deps.jobs.stopWatchdog();
    void app.close().then(() => process.exit(0));
  });
}
