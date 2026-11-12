import fs from 'node:fs/promises';
import path from 'node:path';
import { stableId, readJson, exists, atomicJson, hashFile, inside, plainHtml } from './utils.mjs';
import { normalizedMetadata } from './civitai.mjs';
import { normalizePageDetails } from './details.mjs';
import { isLora, normalizeCategories, rememberCategories } from './categories.mjs';
import { normalizeBaseModels, modelBases } from './base-models.mjs';
import { mergeVersionReferences } from './model-versions.mjs';

const EXT = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx']);
const SIDECAR = file => `${file}.cms`;
export async function tensorMetadata(file) {
  if (!file.endsWith('.safetensors')) return {};
  const handle = await fs.open(file, 'r');
  try {
    const lengthBytes = Buffer.alloc(8); if ((await handle.read(lengthBytes, 0, 8, 0)).bytesRead !== 8) return {};
    const length = Number(lengthBytes.readBigUInt64LE());
    if (!Number.isSafeInteger(length) || length < 2 || length > 16 * 1024 * 1024) return {};
    const buffer = Buffer.alloc(length); if ((await handle.read(buffer, 0, length, 8)).bytesRead !== length) return {};
    return JSON.parse(buffer.toString()).__metadata__ || {};
  } catch { return {}; } finally { await handle.close(); }
}
function guessBase(meta, file) {
  const raw = [meta.ss_base_model_version, meta['modelspec.architecture'], meta.ss_sd_model_name, file].filter(Boolean).join(' ');
  if (/illustrious|illust|noobai/i.test(raw)) return 'Illustrious';
  if (/pony/i.test(raw)) return 'Pony';
  if (/flux/i.test(raw)) return 'Flux';
  if (/sdxl|stable-diffusion-xl/i.test(raw)) return 'SDXL 1.0';
  if (/sd[_ -]?v?1[._-]?5|stable-diffusion-v1/i.test(raw)) return 'SD 1.5';
  return '未知基模';
}
async function findCover(file, sidecar) {
  const covers = [];
  for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif']) { const candidate = path.join(sidecar, name); try { covers.push({ path: candidate, modified: (await fs.stat(candidate)).mtimeMs }); } catch {} }
  if (covers.length) return covers.sort((a, b) => b.modified - a.modified)[0].path;
  const stem = file.slice(0, -path.extname(file).length);
  for (const suffix of ['.preview.png', '.preview.jpg', '.png', '.jpg', '.jpeg', '.webp']) if (await exists(stem + suffix)) return stem + suffix;
  return '';
}
export class Library {
  constructor(store, api, onChange = () => {}) { this.store = store; this.api = api; this.onChange = onChange; this.scanning = false; this.scanProgress = ''; this.busyModels = new Set(); }
  async withModel(id, operation) {
    const model = this.store.model(id); if (!model) throw new Error('模型已移除或不存在');
    if (this.busyModels.has(id) || this.store.removingModels.has(path.resolve(model.path).toLowerCase())) throw new Error('此模型正在处理，请稍后操作');
    this.busyModels.add(id); try { return await operation(); } finally { this.busyModels.delete(id); }
  }
  roots() { return [...new Set(Object.values(this.store.get('settings').paths).filter(Boolean))]; }
  async scan() {
    if (this.scanning || this.store.removingModels.size) return;
    this.scanning = true; this.onChange();
    try {
      const seen = new Set();
      const existingByPath = new Map(this.store.models().map(m => [m.path.toLowerCase(), m]));
      const visit = async (dir, type) => {
        let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) { if (!entry.name.endsWith('.cms') && !entry.name.startsWith('.')) await visit(file, type); continue; }
          if (!EXT.has(path.extname(file).toLowerCase()) || seen.has(file.toLowerCase()) || this.store.isRemoved(file)) continue;
          seen.add(file.toLowerCase()); this.scanProgress = entry.name;
          const prior = existingByPath.get(file.toLowerCase());
          let stat; try { stat = await fs.stat(file); } catch { continue; } const sidecar = SIDECAR(file); const saved = await readJson(path.join(sidecar, 'manifest.json'), {});
          const external = await readJson(file.replace(/\.[^.]+$/, '.civitai.info'), {}) || {};
          const meta = await tensorMetadata(file);
          const metadata = saved.metadata || {};
          const model = { type, name: meta.ss_output_name || path.parse(file).name, versionName: '', baseModel: guessBase(meta, entry.name), baseModelSource: 'inferred', triggerWords: [], description: '', versionDescription: '', creator: '', tags: [], ...prior, ...metadata, id: prior?.id || metadata.id || stableId(file), path: file, filename: entry.name, size: stat.size, modified: stat.mtimeMs, coverPath: await findCover(file, sidecar) || prior?.coverPath || '', missing: false, metadataStatus: saved.metadata ? 'complete' : (prior?.modelId ? prior.metadataStatus : 'local') };
          if (prior?.baseModelSource === 'manual' && Array.isArray(prior.baseModels)) { model.baseModels = normalizeBaseModels(prior.baseModels); model.baseModel = model.baseModels[0] || '未知基模'; model.baseModelSource = 'manual'; }
          if (!model.modelId && external.modelId) { model.modelId = external.modelId; model.versionId = external.id; if (model.baseModelSource !== 'manual') model.baseModel = external.baseModel || model.baseModel; model.triggerWords = external.trainedWords || []; model.name = external.model?.name || model.name; }
          if (prior?.modified !== stat.mtimeMs && prior?.sha256) { model.sha256 = ''; model.metadataStatus = 'changed'; }
          this.store.upsert(model);
        }
      };
      const settings = this.store.get('settings');
      const visitedRoots = new Set();
      for (const [type, dir] of Object.entries(settings.paths)) { if(!dir)continue; const key = path.resolve(dir).toLowerCase(); if (!visitedRoots.has(key)) { visitedRoots.add(key); await visit(dir, type); } }
      for (const model of this.store.models()) if (this.roots().some(root => inside(model.path, root)) && !seen.has(model.path.toLowerCase())) this.store.upsert({ ...model, missing: true });
    } finally { this.scanning = false; this.scanProgress = ''; this.onChange(); }
  }
  async archive(file, bundle, selectedFile, imageUrl = '', coverPath = '', preferences = {}) {
    if (this.store.removingModels.has(path.resolve(file).toLowerCase())) throw new Error('模型正在删除，请稍后重新获取');
    const prior = this.store.models().find(m => m.path.toLowerCase() === file.toLowerCase()) || this.store.removedModels().find(entry => entry.model.path.toLowerCase() === file.toLowerCase())?.model;
    const pageDetails = normalizePageDetails(bundle.pageDetails, bundle);
    const previousDetails = prior?.versionId === bundle.version.id && prior?.origin === bundle.origin ? prior.pageDetails : null;
    const categories = isLora(bundle.model.type) ? normalizeCategories(preferences.loraCategories ?? prior?.loraCategories ?? []) : [];
    const metadata = { ...normalizedMetadata(bundle, selectedFile), loraCategories: categories, baseModelSource: 'api', pageDetails: pageDetails.status === 'captured' ? pageDetails : previousDetails?.status === 'captured' ? previousDetails : pageDetails };
    const sharedFile = prior?.versionId && prior?.fileId && prior?.sha256 && metadata.sha256 && prior.sha256.toUpperCase() === metadata.sha256.toUpperCase() && (prior.versionId !== metadata.versionId || prior.fileId !== metadata.fileId);
    if (sharedFile) {
      metadata.sourceVersions = mergeVersionReferences(prior, metadata);
      for (const key of ['name','sourceName','modelId','versionId','fileId','versionName','origin','sourceUrl','type','baseModel','baseTargets','baseModels','baseModelSource','triggerWords','description','versionDescription','recommendedStrength','pageDetails','air','publishedAt','stats','fileMetadata']) if (prior[key] !== undefined) metadata[key] = prior[key];
      metadata.recommendedStrength = prior.recommendedStrength ?? null;
      metadata.baseTargets = prior.baseTargets || [];
      metadata.sourceName = prior.sourceName || prior.name;
    } else if (prior?.sourceVersions) metadata.sourceVersions = prior.sourceVersions;
    if (prior?.baseModelSource === 'manual') { metadata.baseModels = normalizeBaseModels(prior.baseModels ?? prior.baseModel); metadata.baseModel = metadata.baseModels[0] || '未知基模'; metadata.baseModelSource = 'manual'; }
    const sidecar = SIDECAR(file); await fs.mkdir(sidecar, { recursive: true });
    await atomicJson(path.join(sidecar, `raw-model-${bundle.model.id}.json`), bundle.model);
    if (!sharedFile || prior.modelId === bundle.model.id) await atomicJson(path.join(sidecar, 'raw-model.json'), bundle.model);
    await atomicJson(path.join(sidecar, `raw-version-${bundle.version.id}.json`), bundle.version);
    if (!sharedFile) await atomicJson(path.join(sidecar, 'raw-version.json'), bundle.version);
    await atomicJson(path.join(sidecar, 'details.page.json'), metadata.pageDetails);
    await fs.writeFile(path.join(sidecar, 'readme.model.html'), metadata.description, 'utf8');
    await fs.writeFile(path.join(sidecar, 'readme.version.html'), metadata.versionDescription, 'utf8');
    await fs.writeFile(path.join(sidecar, 'readme.md'), `# ${metadata.name}\n\n${plainHtml(metadata.description)}\n\n## ${metadata.versionName}\n\n${plainHtml(metadata.versionDescription)}\n`, 'utf8');
    await atomicJson(path.join(sidecar, 'manifest.json'), { schemaVersion: 1, metadata, imageUrl, archivedAt: new Date().toISOString() });
    rememberCategories(this.store, categories);
    const stat = await fs.stat(file);
    const result = this.store.restoreModel({ ...prior, ...metadata, id: prior?.id || stableId(file), path: file, filename: path.basename(file), size: stat.size, modified: stat.mtimeMs, coverPath: coverPath || await findCover(file, sidecar), coverRevision: coverPath ? Date.now() : prior?.coverRevision, missing: false, metadataStatus: 'complete' }); this.onChange(); return result;
  }
  async edit(id, changes) {
    return this.withModel(id, () => this.editModel(id, changes));
  }
  async editModel(id, changes) {
    const model = this.store.model(id); if (!model) throw new Error('模型不存在');
    const allowed = Object.fromEntries(['name', 'baseModel', 'triggerWords', 'tags', 'notes', 'favorite'].filter(key => key in changes).map(key => [key, changes[key]]));
    if ('baseModels' in changes || 'baseModel' in changes) { allowed.baseModels = normalizeBaseModels(changes.baseModels ?? changes.baseModel); allowed.baseModel = allowed.baseModels[0] || '未知基模'; allowed.baseModelSource = 'manual'; }
    if ('loraCategories' in changes) { const labels = normalizeCategories(changes.loraCategories); if (!isLora(model.type) && labels.length) throw new Error('只有 LoRA 可设置二级标签'); if (isLora(model.type)) { allowed.loraCategories = labels; rememberCategories(this.store, labels); } }
    const edited = this.store.upsert({ ...model, ...allowed, ...(changes.baseModel ? { baseModelSource: 'manual' } : {}) });
    const sidecar = SIDECAR(model.path); const saved = await readJson(path.join(sidecar, 'manifest.json'), {});
    const { coverPath, ...metadata } = edited;
    await atomicJson(path.join(sidecar, 'manifest.json'), { ...saved, schemaVersion: 1, metadata }); this.onChange(); return edited;
  }
  async enrich(id) {
    const model = this.store.model(id); if (!model || model.missing) throw new Error('本地文件不可用');
    const sha256 = model.sha256 || await hashFile(model.path);
    const origin = this.store.get('settings').sourceOrigin;
    const bundle = await this.api.byHash(sha256, origin);
    const file = bundle.files.find(f => f.hashes?.SHA256?.toUpperCase() === sha256.toUpperCase());
    if (!file) throw new Error('该哈希未匹配到可下载文件');
    return { bundle, file, localPath: model.path };
  }
}
