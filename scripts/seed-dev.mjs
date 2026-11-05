#!/usr/bin/env node
// Base de développement locale uniquement : crée le superuser et un compte de démonstration.
// Ces identifiants n'existent que dans pocketbase/pb_data et ne servent jamais en production.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const superuser = ['dev-superuser@scribator.test', 'dev-superuser-password'];
const demo = { email: 'demo@scribator.test', password: 'demo-password-1234' };

execFileSync('./pocketbase', ['superuser', 'upsert', ...superuser, '--dir=pb_data', '--migrationsDir=pb_migrations'], {
  cwd: path.join(root, 'pocketbase'),
  stdio: 'inherit',
});
const pb = new PocketBase('http://127.0.0.1:8090');
await pb.collection('_superusers').authWithPassword(...superuser);
const found = await pb.collection('users').getList(1, 1, { filter: pb.filter('email = {:e}', { e: demo.email }) });
if (found.totalItems === 0) {
  await pb.collection('users').create({ ...demo, passwordConfirm: demo.password, name: 'Démo', role: 'admin' });
}
console.log(`Compte de démonstration : ${demo.email} / ${demo.password}`);
