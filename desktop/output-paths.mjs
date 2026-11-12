import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { inside } from './utils.mjs';

export function defaultOutputRoot(store) {
  const value = store.get('settings', {})?.automationOutputDirectory;
  if (value && !path.isAbsolute(value)) throw new Error('自动化输出目录需要绝对路径');
  return path.resolve(value || path.join(store.dir, 'outputs'));
}
export function runOutputRoot(store, run) {
  // Older runs predate editable directories and remain at their original root.
  const value = run.outputRoot || path.join(store.dir, 'outputs');
  if (!path.isAbsolute(value)) throw new Error('批次输出目录无效');
  return path.resolve(value);
}
export async function prepareOutputRoot(store, value) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim()))) throw new Error('请填写自动化输出目录的绝对路径');
  const root = value === undefined ? defaultOutputRoot(store) : path.resolve(value.trim());
  await fs.mkdir(root, { recursive: true }); await fs.access(root, constants.W_OK);
  return fs.realpath(root);
}
export function batchOutputDirectory(store, run) {
  const root = runOutputRoot(store, run), folder = run.outputNaming?.folderName;
  if (!folder || path.basename(folder) !== folder || /[<>:"/\\|?*\x00-\x1f]/.test(folder)) throw new Error('批次输出目录名称无效');
  const directory = path.resolve(root, folder); if (!inside(directory, root)) throw new Error('批次输出目录超出范围');
  return directory;
}
export async function allowedResultPath(store, run, file) {
  if (!file || !path.isAbsolute(file)) return null;
  const roots = [store.dir];
  if (run.outputNaming) { try { roots.push(batchOutputDirectory(store, run)); } catch {} }
  try {
    const real = await fs.realpath(file);
    for (const root of roots) {
      try { if (inside(file, root) && inside(real, await fs.realpath(root))) return real; } catch {}
    }
  } catch {}
  return null;
}
