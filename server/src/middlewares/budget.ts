import type PocketBase from 'pocketbase';
import { BudgetExceededError } from '../lib/errors.js';

export function monthStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString().replace('T', ' ');
}

export async function monthlySpend(pb: PocketBase, userId: string): Promise<number> {
  const rows = await pb.collection('ai_calls').getFullList<{ cost_usd: number }>({
    filter: pb.filter('user = {:u} && created >= {:d}', { u: userId, d: monthStart() }),
    fields: 'cost_usd',
    batch: 1000,
  });
  return rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}

export interface BudgetLogger {
  warn(o: object, m?: string): void;
}

export const budgetGuard = (pb: PocketBase, log: BudgetLogger) =>
  async function assertBudget(userId: string): Promise<void> {
    const [user, spent] = await Promise.all([
      pb.collection('users').getOne<{ monthly_budget_usd: number }>(userId, { fields: 'monthly_budget_usd' }),
      monthlySpend(pb, userId),
    ]);
    const budget = user.monthly_budget_usd ?? 0;
    if (spent >= budget) throw new BudgetExceededError(spent, budget);
    if (spent >= budget * 0.8) log.warn({ user: userId, spent, budget }, 'budget proche de la limite');
  };
