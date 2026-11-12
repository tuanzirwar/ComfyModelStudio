import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';

export const id = () => randomUUID();
export const stableId = value => createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 24);
export function safeName(value) {
  let name = path.basename(String(value).replaceAll('\\', '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `model_${name || 'file'}`;
  return name;
}
export async function atomicJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${id()}.tmp`; await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8'); await fs.rename(tmp, file); }
export async function readJson(file, fallback = null) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export function inside(file, root) { const rel = path.relative(path.resolve(root), path.resolve(file)); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
export async function hashFile(file, signal) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file, { signal })) hash.update(chunk); return hash.digest('hex').toUpperCase(); }
export function plainHtml(value = '') { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<\/(p|h[1-6]|li|div)>|<br\s*\/?>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
export function cleanError(error) { return String(error?.message || error).replace(/(?:token|key|signature)=([^&\s]+)/gi, '$1=[redacted]').slice(0, 500); }
