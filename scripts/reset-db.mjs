#!/usr/bin/env node
// Script d'installation / réinitialisation de la base PocketBase à partir du .env (local ou Docker Compose).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pbDir = path.join(root, 'pocketbase');
const pbBin = path.join(pbDir, 'pocketbase');
const migrationsDir = path.join(pbDir, 'pb_migrations');
const hooksDir = path.join(pbDir, 'pb_hooks');
const localComposeFile = path.join(root, 'docker-compose.local.yml');

const USAGE = `Usage : npm run db:reset [-- [options]]

Réinitialise la base PocketBase et crée les comptes depuis le fichier .env.

Options :
  -y, --yes       Supprime et réinitialise la base sans demander confirmation
  --docker        Réinitialise la pile Docker (docker-compose.local.yml, port dynamique)
  --env <chemin>  Chemin vers un fichier .env spécifique (défaut : server/.env et .env)
  --dir <chemin>  Dossier PocketBase cible en mode local (défaut : pocketbase/pb_data)
  -h, --help      Affiche cette aide
`;

function parseCli() {
  const { values } = parseArgs({
    options: {
      yes: { type: 'boolean', short: 'y', default: false },
      force: { type: 'boolean', default: false },
      docker: { type: 'boolean', default: false },
      env: { type: 'string' },
      dir: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  return {
    yes: values.yes || values.force,
    docker: values.docker,
    envPath: values.env ? path.resolve(process.cwd(), values.env) : undefined,
    dataDir: values.dir ? path.resolve(process.cwd(), values.dir) : path.join(pbDir, 'pb_data'),
    help: values.help,
  };
}

/** Charge le .env demandé, ou fusionne .env (racine) et server/.env pour le dev local. */
function loadDotEnv(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Fichier .env introuvable : ${explicitPath}`);
    }
    return { values: parseEnv(readFileSync(explicitPath, 'utf8')), sources: [explicitPath] };
  }

  const candidates = [path.join(root, '.env'), path.join(root, 'server/.env')];
  const merged = {};
  const sources = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    Object.assign(merged, parseEnv(readFileSync(file, 'utf8')));
    sources.push(file);
  }
  if (sources.length === 0) {
    throw new Error(
      'Aucun fichier .env trouvé. Copie server/.env.example vers server/.env (ou .env.example vers .env) puis renseigne-le.',
    );
  }
  return { values: merged, sources };
}

function readConfig(env) {
  const superuserEmail = env.PB_SUPERUSER_EMAIL?.trim() ?? '';
  const superuserPassword = env.PB_SUPERUSER_PASSWORD ?? '';
  if (!superuserEmail || !superuserPassword) {
    throw new Error('PB_SUPERUSER_EMAIL et PB_SUPERUSER_PASSWORD sont obligatoires dans .env.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(superuserEmail)) {
    throw new Error(`PB_SUPERUSER_EMAIL invalide : "${superuserEmail}".`);
  }

  const userEmail = env.PB_USER_EMAIL?.trim() ?? '';
  const userPassword = env.PB_USER_PASSWORD ?? '';
  if (Boolean(userEmail) !== Boolean(userPassword)) {
    throw new Error('PB_USER_EMAIL et PB_USER_PASSWORD doivent être renseignés ensemble dans .env.');
  }
  if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    throw new Error(`PB_USER_EMAIL invalide : "${userEmail}".`);
  }

  return {
    superuserEmail,
    superuserPassword,
    userEmail,
    userPassword,
    userName: env.PB_USER_NAME?.trim() || 'Admin',
  };
}

function ensurePocketBaseBinary() {
  if (existsSync(pbBin)) return;
  console.log('Binaire PocketBase absent, téléchargement via scripts/fetch-pocketbase.sh...');
  execFileSync('bash', [path.join(root, 'scripts/fetch-pocketbase.sh')], { stdio: 'inherit' });
}

/** Refuse d'effacer data.db si un processus PocketBase la garde ouverte. */
function assertDatabaseIdle(dataDir) {
  const dataDb = path.join(dataDir, 'data.db');
  if (!existsSync(dataDb)) return;
  try {
    execFileSync('fuser', [dataDb], { stdio: 'ignore' });
  } catch (err) {
    // fuser quitte avec 1 quand aucun processus n'utilise le fichier, ou ENOENT si absent.
    if (err && typeof err === 'object' && ('status' in err ? err.status !== 0 : true)) return;
  }
  throw new Error(
    `La base ${path.relative(root, dataDir) || dataDir} est en cours d'utilisation. Arrête PocketBase / npm run dev avant de réinitialiser.`,
  );
}

async function confirmReset(label, autoYes, extraFlag = '--yes') {
  if (autoYes) return true;
  if (!process.stdin.isTTY) {
    throw new Error(`Confirmation requise : relance avec ${extraFlag} pour réinitialiser "${label}".`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Réinitialiser "${label}" ? Toutes les données existantes seront supprimées. [o/N] `,
    );
    return /^(o|oui|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Impossible de réserver un port libre.')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForUrl(url, isAlive = () => true, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) {
      throw new Error(`Le service s'est arrêté avant de répondre sur ${url}.`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Service encore en démarrage.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Délai dépassé en attendant ${url}.`);
}

async function stopProcess(proc) {
  if (proc.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

async function pbJson(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body?.data ? ` (${JSON.stringify(body.data)})` : '';
    throw new Error(`${body?.message || `Erreur HTTP ${res.status}`}${details}`);
  }
  return body;
}

async function createAppAdminUserAt(pbBaseUrl, cfg) {
  const auth = await pbJson(`${pbBaseUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    body: JSON.stringify({ identity: cfg.superuserEmail, password: cfg.superuserPassword }),
  });
  await pbJson(`${pbBaseUrl}/api/collections/users/records`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      email: cfg.userEmail,
      password: cfg.userPassword,
      passwordConfirm: cfg.userPassword,
      name: cfg.userName,
      role: 'admin',
    }),
  });
}

/** Démarre un PocketBase éphémère afin que pb_hooks s'appliquent à la création du compte app. */
async function createAppAdminUserLocal(dataDir, cfg) {
  const port = await getFreePort();
  const pbUrl = `http://127.0.0.1:${port}`;
  const args = [
    'serve',
    `--http=127.0.0.1:${port}`,
    '--hooksWatch=false',
    '--automigrate=false',
    `--dir=${dataDir}`,
    `--migrationsDir=${migrationsDir}`,
    `--hooksDir=${hooksDir}`,
  ];
  const stderrChunks = [];
  const proc = spawn(pbBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk.toString()));

  try {
    await waitForUrl(
      `${pbUrl}/api/health`,
      () => {
        if (proc.exitCode !== null) {
          throw new Error(`PocketBase s'est arrêté prématurément : ${stderrChunks.join('').trim()}`);
        }
        return true;
      },
      10_000,
    );
    await createAppAdminUserAt(pbUrl, cfg);
  } finally {
    await stopProcess(proc);
  }
}

async function resetLocal(cli, cfg, sources) {
  ensurePocketBaseBinary();
  assertDatabaseIdle(cli.dataDir);

  const relDir = path.relative(root, cli.dataDir) || cli.dataDir;
  if (existsSync(cli.dataDir) && !(await confirmReset(relDir, cli.yes))) {
    console.log('Annulé.');
    return;
  }

  rmSync(cli.dataDir, { recursive: true, force: true });
  mkdirSync(cli.dataDir, { recursive: true });

  const pbArgs = [`--dir=${cli.dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`];
  execFileSync(pbBin, ['migrate', 'up', ...pbArgs], { stdio: 'inherit' });
  execFileSync(pbBin, ['superuser', 'upsert', cfg.superuserEmail, cfg.superuserPassword, ...pbArgs], {
    stdio: 'inherit',
  });

  if (cfg.userEmail) {
    await createAppAdminUserLocal(cli.dataDir, cfg);
  }

  printSummary({ target: relDir, sources, cfg });
}

async function resetDocker(cli, cfg, sources) {
  if (!(await confirmReset('volumes Docker (docker-compose.local.yml)', cli.yes, '--docker --yes'))) {
    console.log('Annulé.');
    return;
  }

  const composeArgs = ['compose', '-f', localComposeFile];
  execFileSync('docker', [...composeArgs, 'down', '-v'], { cwd: root, stdio: 'inherit' });
  execFileSync('docker', [...composeArgs, 'up', '-d', '--build'], { cwd: root, stdio: 'inherit' });

  const hostPort = execFileSync('docker', [...composeArgs, 'port', 'caddy', '80'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const baseUrl = `http://${hostPort}`;

  await waitForUrl(`${baseUrl}/api/health`, () => true, 30_000);
  await waitForUrl(`${baseUrl}/pb/api/health`, () => true, 15_000);

  if (cfg.userEmail) {
    await createAppAdminUserAt(`${baseUrl}/pb`, cfg);
  }

  printSummary({
    target: 'docker-compose.local.yml (volume pb_data_local)',
    sources,
    cfg,
    appUrl: baseUrl,
  });
}

function printSummary({ target, sources, cfg, appUrl }) {
  const relSources = sources.map((s) => path.relative(root, s) || s).join(', ');
  console.log('');
  console.log(`Base réinitialisée : ${target}`);
  console.log(`Configuration lue  : ${relSources}`);
  console.log(`Superuser PocketBase : ${cfg.superuserEmail}`);
  if (cfg.userEmail) {
    console.log(`Utilisateur app (admin) : ${cfg.userEmail}`);
  } else {
    console.log(
      'Aucun utilisateur app créé (PB_USER_EMAIL / PB_USER_PASSWORD absents du .env). Crée les comptes via /_/.',
    );
  }
  if (appUrl) {
    console.log(`Application        : ${appUrl}`);
    console.log(`Admin PocketBase   : ${appUrl}/pb/_/`);
  }
}

async function main() {
  const cli = parseCli();
  if (cli.help) {
    console.log(USAGE);
    return;
  }

  const { values, sources } = loadDotEnv(cli.envPath);
  const cfg = readConfig(values);

  if (cli.docker) {
    await resetDocker(cli, cfg, sources);
  } else {
    await resetLocal(cli, cfg, sources);
  }
}

main().catch((err) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
