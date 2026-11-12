export function normalizeBaseModels(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，;；、\n]+/) : [];
  if (values.length > 1024) throw new Error('一个模型最多设置 64 个基模');
  const result = [], seen = new Set();
  for (const item of values) {
    if (typeof item !== 'string') throw new Error('基模名称需要文本');
    const label = item.normalize('NFKC').trim();
    if (label.length > 100) throw new Error('基模名称不能超过 100 字');
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); result.push(label);
    if (result.length > 64) throw new Error('一个模型最多设置 64 个基模');
  }
  return result.length > 1 ? result.filter(label => label !== '未知基模') : result;
}
export function modelBases(model) {
  const original = normalizeBaseModels(Array.isArray(model?.baseModels) ? model.baseModels : model?.baseModel);
  const aliases = (model?.sourceVersions || []).flatMap(v => [v.baseModel, ...(v.baseTargets || [])]).filter(Boolean);
  const values = normalizeBaseModels([...original, ...(Array.isArray(model?.baseTargets) ? model.baseTargets : []), ...aliases]);
  return values.length ? values : ['未知基模'];
}
export const baseLabel = model => modelBases(model).join(' / ');
export const hasBase = (model, base) => modelBases(model).some(label => { const target = String(base).normalize('NFKC').trim().toLowerCase(); return label.toLowerCase() === target || (!/\sv\d/i.test(target) && label.toLowerCase().startsWith(`${target} v`)); });
export function baseGroups(models) {
  const groups = new Map();
  for (const model of models) for (const label of modelBases(model).filter((label, _, labels) => label !== 'Other' || !labels.some(other => !['Other','未知基模'].includes(other)))) {
    const family = baseFamily(label);
    if (!groups.has(family)) groups.set(family, { name: family, versions: new Set() });
    if (label.toLowerCase() !== family.toLowerCase()) groups.get(family).versions.add(label);
  }
  return [...groups.values()].map(g => ({ ...g, versions: [...g.versions].sort((a, b) => b.localeCompare(a, 'en', { numeric: true })) })).sort((a, b) => a.name === '未知基模' ? 1 : b.name === '未知基模' ? -1 : a.name.localeCompare(b.name));
}
// These are navigation families only. Model architecture checks and exact
// version compatibility must continue to use hasBase rather than this grouping.
export function baseFamily(label) {
  if (/^NoobAI(?:\b|[-_])/i.test(label)) return 'NoobAI';
  if (/^Anima(?:\b|[-_])/i.test(label)) return 'Anima';
  if (/^(?:SD(?:XL|[ -]?\d)|Stable Diffusion\b)/i.test(label)) return 'Stable Diffusion';
  return label.match(/^(.*?)\s+v\d+(?:\.\d+)*$/i)?.[1] || label;
}
export function matchesBaseFilter(model, filter) {
  return hasBase(model, filter) || modelBases(model).some(label => baseFamily(label).toLowerCase() === filter.toLowerCase());
}
export function baseChoiceLabel(label, family) {
  if (family === 'Stable Diffusion') return label;
  if (family === 'NoobAI') return label.replace(/^NoobAI(?:[- _]*XL)?[- _]*/i,'') || '通用 XL';
  return label.startsWith(family) ? label.slice(family.length).trim() : label;
}
