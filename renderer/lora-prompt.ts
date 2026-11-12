type Entry = { modelId: string };
type Model = { id: string; triggerWords?: unknown };
export function promptTokens(text: string): string[] {
  const parts: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('(['.includes(text[i])) depth++;
    else if (')]'.includes(text[i])) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[,，\n]/.test(text[i])) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts.map(p => p.trim()).filter(Boolean);
}
const key = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/^\((.+):[+-]?(?:\d+(?:\.\d*)?|\.\d+)\)$/, '$1');
const words = (model?: Model) => (Array.isArray(model?.triggerWords) ? model.triggerWords : typeof model?.triggerWords === 'string' ? [model.triggerWords] : []).flatMap(w => typeof w === 'string' ? promptTokens(w) : []);

export function syncLoraPrompt(prompt: string, before: Entry[], after: Entry[], models: Model[]) {
  const old = new Set(before.map(e => e.modelId)), next = new Set(after.map(e => e.modelId));
  const removed = [...old].filter(id => !next.has(id)), added = [...next].filter(id => !old.has(id));
  if (!removed.length && !added.length) return prompt;
  const retained = new Set(models.filter(m => next.has(m.id)).flatMap(words).map(key));
  const deleting = new Set(models.filter(m => removed.includes(m.id)).flatMap(words).map(key).filter(k => !retained.has(k)));
  let result = prompt;
  if (deleting.size) result = promptTokens(result).filter(p => !deleting.has(key(p))).join(', ');
  const present = new Set(promptTokens(result).map(key)), insert: string[] = [];
  for (const id of added) for (const word of words(models.find(m => m.id === id))) if (!present.has(key(word))) { present.add(key(word)); insert.push(word); }
  if (insert.length) result = `${result}${result.trim() ? (/[,，\n]\s*$/.test(result) ? ' ' : ', ') : ''}${insert.join(', ')}`;
  return result;
}
