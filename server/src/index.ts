import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const { app, deps } = await buildApp(env);

await deps.jobs.recoverOnStartup();
deps.jobs.startWatchdog();

await app.listen({ port: env.PORT, host: env.HOST });

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1); // second signal : on n'attend plus
    stopping = true;
    void deps.jobs
      .shutdown()
      .catch((e: unknown) => app.log.error({ err: e }, "échec de l'arrêt des jobs"))
      .then(() => app.close())
      .then(() => process.exit(0));
  });
}
