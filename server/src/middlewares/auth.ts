import type { FastifyReply, FastifyRequest } from 'fastify';
import type PocketBase from 'pocketbase';
import type { Env } from '../config/env.js';
import { AppError, notFound } from '../lib/errors.js';
import { createUserClient } from '../lib/pb.js';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  monthly_budget_usd: number;
  accepted_terms_at: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
    userPb: PocketBase;
  }
}

const unauthorized = () => new AppError(401, 'unauthorized', 'Session expirée, reconnecte-toi.');

export const authenticate = (env: Env) =>
  async function auth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw unauthorized();
    const pb = createUserClient(env, token);
    try {
      const { record } = await pb.collection('users').authRefresh();
      req.user = record as unknown as AuthUser;
      req.userPb = pb;
    } catch {
      throw unauthorized();
    }
  };

/** La lecture passe par le client de l'utilisateur : les règles PocketBase tranchent la propriété. */
export async function getOwned<T>(req: FastifyRequest, collection: string, id: string): Promise<T> {
  try {
    return (await req.userPb.collection(collection).getOne(id)) as T;
  } catch {
    throw notFound();
  }
}
