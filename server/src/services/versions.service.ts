import type PocketBase from 'pocketbase';
import type { VersionRecord } from '../types.js';

const KEEP = 10;

export async function archiveVersion(
  pb: PocketBase,
  v: Pick<VersionRecord, 'project' | 'target_collection' | 'target_id' | 'field' | 'reason'> & { content: unknown },
): Promise<void> {
  const content = typeof v.content === 'string' ? v.content : JSON.stringify(v.content ?? null);
  await pb.collection('versions').create({ ...v, content });
  const rows = await pb.collection('versions').getFullList({
    filter: pb.filter('target_id = {:t} && field = {:f}', { t: v.target_id, f: v.field }),
    sort: '-created,-id',
    fields: 'id',
  });
  for (const row of rows.slice(KEEP)) await pb.collection('versions').delete(row.id);
}
