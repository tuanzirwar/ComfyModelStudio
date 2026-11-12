import { promptSegments } from './prompt-hover.ts';
export type CompletionToken = { start: number; end: number; query: string; source: string };
export function completionToken(text: string, caret: number): CompletionToken | null {
  const segment = promptSegments(text).find(item => caret >= item.start && caret <= item.end);
  if (!segment || /<\s*(?:lora|lyco|embedding)[:\s]/i.test(segment.text)) return null;
  const start = segment.start + (segment.text.match(/^\s*[([{]*/)?.[0].length || 0);
  let end = segment.end;
  const weighted = text.slice(start, end).match(/:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*[\])}]*\s*$/);
  if (weighted) end = start + weighted.index!;
  else if (/[([{]/.test(text.slice(segment.start, start))) end -= text.slice(start, end).match(/[\])}]+\s*$/)?.[0].length || 0;
  end -= text.slice(start, end).match(/\s*$/)?.[0].length || 0;
  const prefix = text.slice(start, Math.min(caret, end)).trim().replaceAll('_', ' ');
  if (!prefix || /^(?:BREAK|AND)$/.test(prefix) || (!/[\u3400-\u9fff]/.test(prefix) && prefix.length < 2) || prefix.length > 100 || caret < start) return null;
  return { start, end, query: prefix, source: text };
}
export function replaceCompletion(text: string, token: CompletionToken, tag: string) {
  if (text !== token.source) return null;
  const word = tag.replaceAll('_', ' ');
  return { text: text.slice(0, token.start) + word + text.slice(token.end), caret: token.start + word.length };
}
export function insertPromptTag(text: string, start: number, end: number, tag: string) {
  const normalize = (word: string) => word.replaceAll('_', ' ').normalize('NFKC').trim().toLowerCase();
  const present = new Set(text.split(/[,，\n]/).map(normalize));
  if (start === end && tag.split(/[,，\n]/).map(normalize).filter(Boolean).every(word => present.has(word))) return { text, caret: start };
  const left = text.slice(0, start), right = text.slice(end), word = tag.replaceAll('_', ' ');
  const prefix = left && !/[,，\n]\s*$/.test(left) ? ', ' : left && !/\s$/.test(left) ? ' ' : '';
  const suffix = right && !/^\s*[,，\n]/.test(right) ? ', ' : '';
  const inserted = prefix + word + suffix;
  return { text: left + inserted + right, caret: left.length + inserted.length };
}

export function completePromptWeight(text: string, start: number, end = start) {
  const segment = promptSegments(text).find(row => start >= row.start && start <= row.end);
  if (!segment || /<[^>]*$/.test(text.slice(segment.start, start))) return null;
  let left = start === end ? segment.start : start, right = start === end ? segment.end : end;
  const raw = text.slice(left,right), lead = raw.match(/^\s*/)?.[0] || '', tail = raw.match(/\s*$/)?.[0] || '';
  const word = raw.trim(); if (!word || word.includes(':')) return null;
  const inner = word.startsWith('(') && word.endsWith(')') ? word.slice(1,-1) : word;
  const replacement = lead + '(' + inner + ':1.0)' + tail;
  const result = text.slice(0,left) + replacement + text.slice(right);
  const weightStart = left + lead.length + inner.length + 2;
  return { text: result, start: weightStart, end: weightStart + 3 };
}
