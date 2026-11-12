export const WAI = 'WAI-NSFW-illustrious-SDXL';
const clean = value => String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export function baseTargets(model, version) {
  const apiBase = version.baseModel || '未知基模';
  if (Number(model.id) === 827184) return [`${WAI} ${version.name.replace(/^v/i, 'v')}`];
  if (Number(model.id) === 833294) { const match = version.name.match(/(Epsilon|V)[- ]?(?:pred)[- ]+(\d+(?:\.\d+)?)/i); if (match) return [`NoobAI-XL ${/^v$/i.test(match[1]) ? 'V-Pred' : 'Epsilon'} v${Number(match[2]).toFixed(1)}`]; }
  if (Number(model.id) === 2458426) { const match = version.name.match(/^(base|turbo|aesthetic)-v(\d+(?:\.\d+)?)/i); if (match) return [`Anima${match[1] === 'base' ? '' : ` ${match[1][0].toUpperCase()}${match[1].slice(1)}`} v${Number(match[2]).toFixed(1)}`]; }
  const own = clean(version.description), name = version.name || '', result = [];
  if (apiBase === 'Other') {
    const explicit = clean(model.description).match(/Base model\s*[:：]\s*Anything\s*[vV]\s*(\d+(?:\.\d+)?)/i);
    if (explicit) result.push(`Anything v${Number(explicit[1]).toFixed(1)}`);
    if (/Trained on NAI\b/i.test(own)) result.push('NAI（版本未注明）');
  }
  // Model-wide READMEs often describe files for different architectures.
  if (/illustrious|sdxl|noob/i.test(apiBase) && !/anima/i.test(apiBase)) {
    for (const match of `${own} ${name}`.matchAll(/WAI(?:[-\s]*(?:NSFW))?(?:[-\s]*illustrious)?(?:[-\s]*SDXL)?\s*(?:base\s*)?[vV]\s*(\d+(?:\.\d+)?)/gi)) result.push(`${WAI} v${Number(match[1]).toFixed(1)}`);
    if (!result.length && /\bWAI\b/i.test(`${own} ${name}`)) result.push(WAI);
    if (!result.length && /WAI[-\s]*(?:NSFW[-\s]*)?illustrious/i.test(clean(model.description)) && !(model.modelVersions || []).some(v => /anima/i.test(v.baseModel))) result.push(WAI);
    if (/NoobAI[-\s]*XL[-\s]*E11/i.test(own)) result.push('NoobAI-XL Epsilon v1.1');
    if (!result.length && /(?:NAI|NoobAI)[-\s]*XL.*?VPRED/i.test(`${own} ${name}`)) result.push('NoobAI-XL V-Pred');
  }
  if (/anima/i.test(apiBase)) { const match = own.match(/Anima\s*(?:base\s*)?[vV]\s*(\d+(?:\.\d+)?)/i); if (match) result.push(`Anima v${Number(match[1]).toFixed(1)}`); }
  return [...new Set(result)];
}
function weightFrom(text) {
  const patterns = [/(?:recommended|suggested|best)?\s*(?:LoRA\s*)?weight\s*(?:is|to|around)?\s*[:：]?\s*[~～]?\s*(\d+(?:\.\d+)?)\s*(?:[-~～–]\s*(\d+(?:\.\d+)?))?/i, /(?:推荐|建议)?权重\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:[-~～–]\s*(\d+(?:\.\d+)?))?/i, /(?:good|best)\s+at\s+(\d+(?:\.\d+)?)\s*weight/i];
  for (const pattern of patterns) {
    const match = text.match(pattern); if (!match) continue;
    if (/lower|decrease|increase|降低|减小/i.test(text.slice(Math.max(0, match.index - 30), match.index))) continue;
    const min = Number(match[1]), max = match[2] ? Number(match[2]) : min;
    if (min < 0 || max < min || max > 3) continue;
    const start = text.slice(match.index + match[0].length, match.index + match[0].length + 80).match(/start\s+at\s+(\d+(?:\.\d+)?)/i);
    const value = start && Number(start[1]) >= min && Number(start[1]) <= max ? Number(start[1]) : Math.round((min + max) / 2 * 1000) / 1000;
    return { value, min, max, text: match[0].trim() };
  }
  return null;
}
export function recommendedStrength(model, version) {
  const direct = weightFrom(clean(version.description));
  if (direct) return { ...direct, source: 'version-readme', versionId: version.id };
  const mixed = new Set((model.modelVersions || [version]).map(v => v.baseModel)).size > 1;
  const sections = String(model.description || '').split(/<hr\b[^>]*>|<h[1-6]\b[^>]*>/i).map(clean);
  const matching = sections.filter(section => {
    if (/anima/i.test(version.baseModel)) return /\banima\b/i.test(section) && !/\b(?:WAI|Pony)\b/i.test(section);
    if (/illustrious|sdxl|noob/i.test(version.baseModel)) return /\b(?:WAI|illustrious|sdxl|noob)\b/i.test(section) && !/\banima\b/i.test(section);
    if (/pony/i.test(version.baseModel)) return /\bpony\b/i.test(section) && !/\banima\b/i.test(section);
    return false;
  });
  const neutral = sections.filter(section => !/\b(?:anima|illustrious|sdxl|pony|noob|wai)\b/i.test(section));
  const matched = matching.map(weightFrom).filter(Boolean);
  const recommendations = mixed ? matched.length ? matched : neutral.map(weightFrom).filter(Boolean) : [weightFrom(clean(model.description))].filter(Boolean);
  if (new Set(recommendations.map(r => `${r.min}:${r.max}`)).size !== 1) return null;
  return { ...recommendations[0], source: 'model-readme', versionId: version.id };
}
export function versionCatalog(model) {
  return (model.modelVersions || []).map(version => {
    const files = (version.files || []).filter(f => ['Model', 'Pruned Model'].includes(f.type) && f.downloadUrl);
    const file = files.find(f => f.primary) || files[0];
    return { id: version.id, name: version.name, baseModel: version.baseModel || '未知基模', baseTargets: baseTargets(model, version), recommendedStrength: recommendedStrength(model, version), publishedAt: version.publishedAt || version.createdAt || '', downloadable: Boolean(file), fileId: file?.id, filename: file?.name, sizeKB: file?.sizeKB || 0 };
  });
}
export function latestPerBase(versions) {
  const groups = new Map();
  for (const version of [...versions].filter(v => v.downloadable).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || b.id - a.id)) {
    for (const base of /^Anima(?:\b|[-_])/i.test(version.baseModel) ? ['Anima'] : version.baseTargets?.length ? version.baseTargets : [version.baseModel]) if (!groups.has(base)) groups.set(base, version);
  }
  return [...new Map([...groups.values()].map(version => [version.id, version])).values()];
}
