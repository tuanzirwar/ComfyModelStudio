import fs from 'node:fs/promises';
import path from 'node:path';
import { id } from './utils.mjs';
import { sourceOrigin } from './civitai.mjs';

export async function loadCredentials(file, crypto) {
  try {
    const value = JSON.parse(await crypto.decryptString(await fs.readFile(file)));
    const tokens = new Map();
    for (const [origin, token] of Object.entries(value)) {
      if (sourceOrigin(origin) === origin && typeof token === 'string' && /^[A-Za-z0-9_.-]{16,256}$/.test(token)) tokens.set(origin, token);
    }
    return { tokens, error: '' };
  } catch (error) {
    return { tokens: new Map(), error: error.code === 'ENOENT' ? '' : '本机密钥无法解密，请在此重新保存 API Key。原加密文件会保留备份。' };
  }
}
export async function saveCredentials(file, crypto, tokens, { backupUnreadable = false } = {}) {
  if (!crypto.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，未保存密钥');
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (backupUnreadable) {
    const folder = path.join(path.dirname(file), 'backups'); await fs.mkdir(folder, { recursive: true });
    await fs.copyFile(file, path.join(folder, `credentials-unreadable-${id()}.bin`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  const encrypted = await crypto.encryptString(JSON.stringify(Object.fromEntries(tokens)));
  // The app must use its own userData encryption context. Verify before commit.
  if (await crypto.decryptString(encrypted) !== JSON.stringify(Object.fromEntries(tokens))) throw new Error('本机凭据加密校验失败，未替换原密钥');
  const temp = `${file}.${id()}.tmp`;
  try { await fs.writeFile(temp, encrypted); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
