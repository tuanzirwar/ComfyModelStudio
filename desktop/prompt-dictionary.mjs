import fs from 'node:fs/promises';
let index, searchableIndex;
const translations = new WeakMap();
const prepared = new WeakMap();
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replaceAll('_', ' ').trim();
export function searchPromptTags(rows, query, limit = 80, offset = 0) {
  const q = normalize(query).slice(0, 100), terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  if (!prepared.has(rows)) prepared.set(rows, rows.map(row => ({ row, text: normalize(`${row[0]} ${row[1]} ${row[2]}`), en: normalize(row[1]), zh: normalize(row[0]), aliases: row[0].split(' / ').map(normalize) })));
  const matches = [];
  for (const entry of prepared.get(rows)) {
    const { row, text } = entry;
    const [zh, en, category, source] = row;
    if (!terms.every(term => text.includes(term))) continue;
    const score = entry.en === q || entry.aliases.includes(q) ? 0 : entry.zh.startsWith(q) || entry.en.startsWith(q) ? 1 : 2;
    matches.push({ zh, en, category, source, score });
  }
  return matches.sort((a,b) => a.score-b.score || a.zh.length-b.zh.length || a.en.localeCompare(b.en)).slice(Math.max(0, offset), Math.max(0, offset) + Math.min(80, limit));
}
export async function promptTagSearch(query, offset = 0) {
  index ||= fs.readFile(new URL('./data/prompt-tags.json', import.meta.url), 'utf8').then(JSON.parse);
  const original = await index;
  if (!searchableIndex) {
    const unique = new Map();
    for (const row of [...Object.entries(commonTranslations).map(([en, zh]) => [zh, en, '常用词', 'studio']), ...original]) {
      const key = normalize(row[1]); if (!key) continue;
      const existing = unique.get(key);
      if (!existing) unique.set(key, [...row]);
      else if (!existing[0].includes(row[0])) existing[0] = [...new Set(`${existing[0]} / ${row[0]}`.split(' / '))].join(' / ');
    }
    searchableIndex = [...unique.values()];
  }
  const rows = searchableIndex;
  const results = searchPromptTags(rows, query, 80, Math.max(0, Math.min(100000, Number(offset) || 0)));
  return { total: rows.length, results, hasMore: results.length === 80 };
}

export function normalizeTranslationTag(value) {
  return normalize(value).replace(/\\([()[\]])/g, '$1').replace(/^[([{\s]+/, '').replace(/[\])}\s]+$/, '').replace(/:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/, '').trim().replace(/\s+/g, ' ').replace(/\b([1-9])\s+(girls?|boys?)\b/g, '$1$2');
}
const commonTranslations = {
  "masterpiece": "杰作",
  "best quality": "最佳质量",
  "high quality": "高质量",
  "low quality": "低质量",
  "worst quality": "最差质量",
  "normal quality": "普通质量",
  "soft lighting": "柔和光照",
  "clear lines": "清晰线条",
  "detailed illustration": "细节丰富的插画",
  "highres": "高分辨率",
  "8k": "8K 分辨率",
  "uhd": "超高清",
  "long hair": "长发",
  "backlighting": "逆光",
  "smile": "微笑",
  "cel shading": "赛璐璐风格上色",
  "landscape": "风景",
  "watercolor": "水彩",
  "mountain": "山峰",
  "forest": "森林",
  "lake": "湖泊",
  "sunlight": "阳光",
  "blue sky": "蓝天",
  "clouds": "云朵",
  "portrait": "肖像",
  "1girl": "1个女孩",
  "1boy": "一个男孩",
  "solo": "单人",
  "red hair": "红发",
  "short hair": "短发",
  "flower": "花朵",
  "full body": "全身",
  "depth of field": "景深",
  "line art": "线稿",
  "detailed anime illustration": "细节丰富的动漫插画",
  "clear illustration": "清晰的插画",
  "anime coloring": "动漫上色",
  "hyper-realistic shading": "超写实明暗表现",
  "great detail": "丰富细节",
  "great detailed": "细节丰富",
  "newest": "最新",
  "hi res": "高分辨率"
};

export function translatePromptTag(rows, input) {
  const tag = normalizeTranslationTag(String(input || '').slice(0, 400));
  if (!translations.has(rows)) {
    const map = new Map();
    for (const row of rows) if (/[\u3400-\u9fff]/.test(row[0])) { const key = normalizeTranslationTag(row[1]); if (!map.has(key)) map.set(key, { en: row[1], zh: row[0] }); }
    for (const [en, zh] of Object.entries(commonTranslations)) map.set(en, { en, zh });
    translations.set(rows, map);
  }
  const map = translations.get(rows), exact = map.get(tag);
  if (exact) return { tag, match: 'full', zh: exact.zh, parts: [], unknown: [] };
  const words = tag.split(' ').filter(Boolean), parts = [], unknown = [];
  for (let i = 0; i < words.length;) {
    let found;
    for (let length = Math.min(8, words.length - i); length > 0; length--) { const en = words.slice(i, i + length).join(' '), row = map.get(en); if (row) { found = { ...row, en, length }; break; } }
    if (found) { parts.push({ en: found.en, zh: found.zh }); i += found.length; } else { unknown.push(words[i]); i++; }
  }
  return { tag, match: parts.length ? 'partial' : 'none', zh: '', parts, unknown };
}
export async function promptTagTranslation(text) {
  index ||= fs.readFile(new URL('./data/prompt-tags.json', import.meta.url), 'utf8').then(JSON.parse);
  return translatePromptTag(await index, text);
}

export async function promptTagTranslations(texts) {
  index ||= fs.readFile(new URL('./data/prompt-tags.json', import.meta.url), 'utf8').then(JSON.parse);
  const rows = await index;
  return (Array.isArray(texts) ? texts : []).slice(0, 128).map(text => translatePromptTag(rows, String(text || '')));
}
