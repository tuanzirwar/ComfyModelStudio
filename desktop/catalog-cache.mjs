import path from 'node:path';
import { normalizedMetadata } from './civitai.mjs';
import { atomicJson, readJson } from './utils.mjs';

export async function reconcileCatalog(store) {
  const cache = new Map(); let changed = 0;
  for (const local of store.models()) {
    if (!local.modelId || !local.versionId || local.missing) continue;
    if (!cache.has(local.modelId)) cache.set(local.modelId, await readJson(path.join(store.dir, 'catalog', `${local.modelId}.json`)));
    const model = cache.get(local.modelId), version = model?.modelVersions?.find(v => v.id === local.versionId);
    if (!version || model.id !== local.modelId) continue;
    const file = version.files?.find(f => f.id === local.fileId) || version.files?.find(f => f.name === local.filename);
    if (!file) continue;
    const metadata = normalizedMetadata({ model, version, origin: local.origin || 'https://civitai.red' }, file);
    const patch = { baseTargets: metadata.baseTargets, recommendedStrength: metadata.recommendedStrength, ...(local.modelId === 827184 ? { name: metadata.name } : {}) };
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(local[key]) === JSON.stringify(value))) continue;
    const next = { ...local, ...patch };
    const manifestPath = path.join(`${local.path}.cms`, 'manifest.json'), manifest = await readJson(manifestPath, {});
    const { coverPath, ...saved } = next;
    await atomicJson(manifestPath, { ...manifest, schemaVersion: 1, metadata: saved });
    store.upsert(next); changed++;
  }
  return changed;
}
