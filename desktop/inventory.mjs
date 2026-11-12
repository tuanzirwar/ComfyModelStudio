import { baseLabel } from './base-models.mjs';
const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
export function modelInventory(models) {
  const lines = ['# 本地模型备份清单', '', `生成时间：${new Date().toISOString()}`, '', `共 ${models.length} 个模型。此清单记录来源和本地路径，不包含模型权重或密钥。`, '', '| 模型 | 类型 | 基础模型 | 二级标签 | 来源地址 | 本地路径 | SHA256 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const model of [...models].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))) {
    let source = model.sourceUrl || (model.modelId && model.versionId ? `${model.origin || 'https://civitai.red'}/models/${model.modelId}?modelVersionId=${model.versionId}` : '未关联来源');
    try { const u = new URL(source); for (const key of [...u.searchParams.keys()]) if (/token|key|signature/i.test(key)) u.searchParams.delete(key); u.username = ''; u.password = ''; source = u.href; } catch {}
    lines.push(`| ${[model.name, model.type, baseLabel(model), (model.loraCategories || []).join('、'), source, model.path, model.sha256 || '未计算'].map(cell).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}
