import path from 'node:path';
import { inside, readJson, atomicJson } from './utils.mjs';
import { sourceOrigin } from './civitai.mjs';
import { modelHasVersion } from './model-versions.mjs';

export async function importCatalogDownloads(store) {
  const file = path.join(store.dir, 'catalog-maintenance', 'handoff.json');
  const handoff = await readJson(file);
  if (!handoff || handoff.status !== 'pending') return 0;
  if (!Array.isArray(handoff.jobs) || handoff.jobs.length > 500) throw Error('模型补齐队列格式无效');
  const settings = store.get('settings'), jobs = store.get('downloads', []), added = [];
  for (const job of handoff.jobs) {
    const root = settings.paths[job.type];
    if (!root || !Number.isSafeInteger(job.versionId) || job.versionId < 1 || !Number.isSafeInteger(job.fileId) || job.fileId < 1 || !job.id || !job.key || !job.destination || !inside(job.destination, root)) throw Error('模型补齐任务的目标目录或版本无效');
    sourceOrigin(job.origin);
    if (jobs.some(j => j.key === job.key || j.destination.toLowerCase() === job.destination.toLowerCase())) continue;
    if (store.models().some(m => !m.missing && [m,...(m.sourceVersions || [])].some(v => v.versionId === job.versionId && v.fileId === job.fileId))) continue;
    added.push({ ...job, status: store.get('downloadQueuePaused', false) ? 'paused' : 'queued', speed: 0, error: '' });
  }
  store.set('downloads', [...jobs, ...added]);
  await atomicJson(file, { ...handoff, status: 'imported', importedAt: new Date().toISOString(), importedCount: added.length });
  return added.length;
}
