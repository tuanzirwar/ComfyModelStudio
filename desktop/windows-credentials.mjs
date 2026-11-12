import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';

const prefix = Buffer.from('CMS-DPAPI-1\0');
export function protectForUser(value, decrypt = false) {
  return new Promise((resolve, reject) => {
    const operation = decrypt ? 'Unprotect' : 'Protect';
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) return reject(new Error('Windows 用户凭据加密操作失败'));
      resolve(Buffer.from(stdout.trim(), 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

// DPAPI binds credentials to the Windows user, independent of Chromium's
// replaceable Local State encryption key and versioned executable directory.
export function credentialCrypto(safeStorage, dataDir) {
  if (process.platform !== 'win32') return safeStorage;
  return {
    isEncryptionAvailable: () => true,
    encryptString: async value => Buffer.concat([prefix, await protectForUser(Buffer.from(value, 'utf8'))]),
    decryptString: async value => {
      if (value.subarray(0, prefix.length).equals(prefix)) return (await protectForUser(value.subarray(prefix.length), true)).toString('utf8');
      try { return safeStorage.decryptString(value); }
      catch {
        // Compatibility with existing v10 files when Electron cannot open them.
        const state = JSON.parse(await fs.readFile(path.join(dataDir, 'Local State'), 'utf8'));
        const wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64');
        if (wrapped.subarray(0, 5).toString() !== 'DPAPI' || value.subarray(0, 3).toString() !== 'v10') throw new Error('不支持的旧凭据格式');
        const key = await protectForUser(wrapped.subarray(5), true);
        const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(3, 15));
        decipher.setAuthTag(value.subarray(-16));
        return Buffer.concat([decipher.update(value.subarray(15, -16)), decipher.final()]).toString('utf8');
      }
    },
  };
}
