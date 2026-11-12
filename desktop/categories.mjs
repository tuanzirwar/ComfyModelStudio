export const isLora = type => ['LORA', 'LoCon', 'DoRA'].includes(type);
export function normalizeCategories(value = []) {
  if (!Array.isArray(value) || value.length > 30 || value.some(label => typeof label !== 'string')) throw new Error('二级标签需要列表，最多选择 30 个');
  const labels = value.map(label => label.normalize('NFKC').trim());
  if (labels.some(label => !label || label.length > 40 || /[\x00-\x1f]/.test(label))) throw new Error('二级标签需要 1–40 个字符，不能包含换行');
  return [...new Map(labels.map(label => [label.toLocaleLowerCase(), label])).values()];
}
export function loraCategories(store) { return normalizeCategoriesUnion([...store.get('loraCategories', []), ...store.models().filter(model => isLora(model.type)).flatMap(model => model.loraCategories || [])]); }
function normalizeCategoriesUnion(labels) { return [...new Map(labels.filter(label => typeof label === 'string' && label.trim()).map(label => [label.normalize('NFKC').trim().toLowerCase(), label.normalize('NFKC').trim()])).values()].sort((a, b) => a.localeCompare(b, 'zh-CN')); }
export function rememberCategories(store, labels) { const merged = normalizeCategoriesUnion([...loraCategories(store), ...normalizeCategories(labels)]); store.set('loraCategories', merged); return merged; }
