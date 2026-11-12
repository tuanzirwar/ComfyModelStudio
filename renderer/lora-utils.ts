import { modelBases, normalizeBaseModels, hasBase } from '../desktop/base-models.mjs';
export type LoraModel = Record<string, any> & { id: string; type?: string; name?: string; baseModel?: string };
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export function triggerWords(value: unknown): string[] {
  const words = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  return words.filter((word): word is string => typeof word === 'string').map(word => word.trim()).filter(word => { const key = normalize(word); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
export function sameBase(a?: string | string[], b?: string | string[]) { return normalizeBaseModels(a).some(left => left !== '未知基模' && normalizeBaseModels(b).some(right => right !== '未知基模' && normalize(left) === normalize(right))); }
export function loraMatchKind(model: LoraModel, checkpointBase?: string) {
  const precise = [...(model.baseTargets || []), ...(model.sourceVersions || []).flatMap((version: Record<string, any>) => version.baseTargets || [])].filter(label => /\bv\d/i.test(label));
  if (sameBase(precise, checkpointBase)) return 'version';
  const checkpointVersions = normalizeBaseModels(checkpointBase).filter(label => /\bv\d/i.test(label));
  const family = (label: string) => normalize(label.replace(/\s+v\d.*$/i, ''));
  if (!sameBase(model.baseModels || [], checkpointVersions) && precise.some(target => checkpointVersions.some(checkpoint => family(target) === family(checkpoint)))) return 'version-mismatch';
  return sameBase(modelBases(model), checkpointBase) ? 'base' : 'none';
}
export function initialLoraBase(models: LoraModel[], checkpointBase?: string, initialId?: string) {
  return !initialId && loraOptions(models, { base: 'compatible', checkpointBase: checkpointBase || '' }).length ? 'compatible' : 'all';
}
export function validLoraBase(base: string, bases: string[], checkpointBase?: string) {
  if (base === 'all') return base;
  if (base === 'compatible') return normalizeBaseModels(checkpointBase).some(label => label !== '未知基模') ? base : 'all';
  return bases.includes(base) ? base : 'all';
}
export function matchesCategory(model: LoraModel, category = 'all') { const labels = Array.isArray(model.loraCategories) ? model.loraCategories : []; return category === 'all' || (['LORA', 'LoCon', 'DoRA'].includes(model.type || '') && (category === 'none' ? !labels.length : labels.includes(category.slice(4)))); }
export function loraOptions(models: LoraModel[], { query = '', base = 'all', checkpointBase = '', category = 'all', includeMissing = false } = {}) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const rank = (model: LoraModel) => ({ version: 3, base: 2, 'version-mismatch': 1, none: 0 })[loraMatchKind(model, checkpointBase)];
  return models.filter(model => matchesCategory(model, category) && ['LORA', 'LoCon', 'DoRA'].includes(model.type || '') && (includeMissing || !model.missing) && (base === 'all' || (base === 'compatible' ? ['version','base'].includes(loraMatchKind(model, checkpointBase)) : hasBase(model, base))) && tokens.every(token => normalize([model.name, model.versionName, model.filename, ...modelBases(model), ...(model.loraCategories || []), ...triggerWords(model.triggerWords), ...(Array.isArray(model.tags) ? model.tags : [])].filter(Boolean).join(' ')).includes(token))).sort((a, b) => rank(b) - rank(a) || Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || String(a.name || a.filename || '').localeCompare(String(b.name || b.filename || ''), 'zh-CN') || a.id.localeCompare(b.id));
}
export function appendTriggerWords(prompt: string, words: unknown) {
  const original = String(prompt || '');
  const present = new Set(original.split(/[,，\n]+/).map(token => normalize(token).replace(/^\((.+):[+-]?(?:\d+(?:\.\d*)?|\.\d+)\)$/, '$1')));
  const missing = triggerWords(words).filter(word => !present.has(normalize(word)));
  if (!missing.length) return original;
  if (!original.trim()) return missing.join(', ');
  return `${original}${/[,，\n]\s*$/.test(original) ? (/\n\s*$/.test(original) ? '' : ' ') : ', '}${missing.join(', ')}`;
}
export function sourceSummary(model: Record<string, any> = {}) {
  const api = ['https://civitai.red', 'https://civitai.com'].includes(model.origin) && Number.isSafeInteger(model.modelId) && model.modelId > 0 && Number.isSafeInteger(model.versionId) && model.versionId > 0;
  const captured = model.pageDetails?.status === 'captured';
  return { api, apiArchived: api && model.metadataStatus === 'complete', captured, pageMismatch: model.pageDetails?.status === 'version-mismatch', hasModelReadme: typeof model.description === 'string' && Boolean(model.description.trim()), hasVersionReadme: typeof model.versionDescription === 'string' && Boolean(model.versionDescription.trim()) };
}
