// Shared by the editor and the submission boundary. Preserve escapes, attention,
// names and intentional repeats; only normalize separators and invisible spaces.
export function normalizePrompt(input) {
  const text = String(input || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000\t]/g, ' ');
  let part = '', escaped = false, angle = 0; const parts = [];
  const flush = () => { const value = part.replace(/ +/g, ' ').trim(); if (value) parts.push(value); part = ''; };
  for (const char of text) {
    if (!escaped && char === '<') angle++;
    if (!escaped && char === '>') angle = Math.max(0, angle - 1);
    if (!escaped && !angle && /[,，\n]/.test(char)) flush(); else part += char;
    escaped = char === '\\' && !escaped;
  }
  flush(); return parts.join(', ');
}
export function promptSyntaxIssues(text) {
  const stack = [], issues = []; let escaped = false, angle = 0;
  for (const char of String(text)) {
    if (!escaped) {
      if (char === '<') angle++;
      else if (char === '>') angle = Math.max(0, angle - 1);
      else if (!angle && '(['.includes(char)) stack.push(char);
      else if (!angle && ')]'.includes(char)) { if (stack.pop() !== (char === ')' ? '(' : '[')) issues.push('提示词括号不匹配'); }
    }
    escaped = char === '\\' && !escaped;
  }
  if (stack.length) issues.push('提示词存在未闭合括号');
  if (/:\s*(?:\)|,|$)/.test(text)) issues.push('提示词权重缺少数值，请使用 (词组:1.0)');
  if (/:\s*(?:NaN|Infinity)\b/i.test(text)) issues.push('提示词权重不是有效数字');
  for (const match of text.replace(/<[^>]*>/g, '').matchAll(/:\s*([^(),\[\]]*)\)/g)) if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(match[1].trim()) || !Number.isFinite(Number(match[1]))) issues.push('提示词权重不是有效数字');
  return [...new Set(issues)];
}
