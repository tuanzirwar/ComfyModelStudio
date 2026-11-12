import { sourceOrigin } from './civitai.mjs';

// The snapshot is untrusted extension input. Bind it to the exact version and
// persist text only, with bounded size. Never render source HTML from the page.
export function normalizePageDetails(input, bundle) {
  if (!input || (!input.origin && !input.entries?.length && input.status !== 'version-mismatch')) return { schemaVersion: 1, status: 'missing', entries: [], message: '未采集网页 Details；已保存 API 资料。' };
  let origin = ''; try { origin = sourceOrigin(input.origin); } catch {}
  if (origin !== bundle.origin || Number(input.modelId) !== bundle.model.id || Number(input.versionId) !== bundle.version.id) {
    return { schemaVersion: 1, status: 'version-mismatch', entries: [], message: '网页 Details 与下载版本不一致，未将其归入该版本；请切换页面版本后重新采集。' };
  }
  const entries = [];
  for (const entry of Array.isArray(input.entries) ? input.entries.slice(0, 50) : []) {
    const label = String(entry.label || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 60);
    const value = String(entry.value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, 2000);
    if (!label || !value || /^(Training|Usage Tips|训练|训练步数|Epoch|推荐强度)$/i.test(label) || entries.some(e => e.label.toLowerCase() === label.toLowerCase())) continue;
    entries.push({ label, value });
  }
  const has = re => entries.some(e => re.test(e.label));
  const missing = [['Type', /^(type|类型)$/i], ['Base Model', /^(base model|基础模型)$/i]].filter(([, re]) => !has(re)).map(([label]) => label);
  const captured = entries.length > 0 && !missing.length;
  const base = entries.find(e => /^(base model|基础模型)$/i.test(e.label))?.value;
  const type = entries.find(e => /^(type|类型)$/i.test(e.label))?.value;
  const air = entries.find(e => /^AIR$/i.test(e.label))?.value?.replace(/\s/g, '').match(/(?:civitai:|civitai\/)(\d+)@(\d+)/i);
  const normalize = value => String(value || '').toLowerCase().replace(/[\s_-]/g, '');
  if ((base && bundle.version.baseModel && normalize(base) !== normalize(bundle.version.baseModel)) || (type && normalize(type) !== normalize(bundle.model.type)) || (air && (Number(air[1]) !== bundle.model.id || Number(air[2]) !== bundle.version.id))) {
    return { schemaVersion: 1, status: 'version-mismatch', entries: [], message: '网页 Details 与 API 版本内容不一致，页面可能正在切换。请等待加载完成后重新采集。' };
  }
  return { schemaVersion: 1, origin: bundle.origin, modelId: bundle.model.id, versionId: bundle.version.id, pageUrl: `${bundle.origin}/models/${bundle.model.id}?modelVersionId=${bundle.version.id}`, capturedAt: Number.isFinite(Date.parse(input.capturedAt)) ? input.capturedAt : new Date().toISOString(), status: captured ? 'captured' : 'missing', missing, entries, message: captured ? '' : '网页 Details 未完整采集；请展开后重新读取。API 资料已单独保存。' };
}
