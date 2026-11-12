import fs from 'node:fs/promises';
import path from 'node:path';
import { allowedResultPath } from './output-paths.mjs';
import { inside, readJson } from './utils.mjs';

const activeItems = new Set(['submitting', 'remote_queued', 'running', 'archiving', 'unknown']);
const imageFile = file => /\.(png|jpe?g|webp|avif)$/i.test(file);
const canonical = file => path.resolve(file).toLowerCase();

export function deletionBlock(execution, run, { ignoreDeleting = false, allowCancel = false } = {}) {
  if (!ignoreDeleting && execution.deleting?.has(run.id)) return '该批次正在删除，请稍候';
  if (execution.active?.run?.id === run.id || ['running', 'pausing', 'preparing'].includes(run.status)) return '请先取消批次，或等待当前生成和归档结束后再删除';
  if (!allowCancel && run.items.some(item => activeItems.has(item.status))) return '该批次仍有正在执行或状态未确认的任务，请先继续对账或取消批次';
  return '';
}

// Records and automation collections are two views of the same run. Serialize
// deletion with exports, selection and numbering so no removed run can reappear.
export class RecordsService {
  constructor(store, execution, outputs, { trashItem } = {}) { this.store = store; this.execution = execution; this.outputs = outputs; this.trashItem = trashItem; execution.deleting ||= new Set(); }
  find(runId) { const run = this.execution.runs.find(run => run.id === runId); if (!run) throw new Error('该批次已删除或不存在'); return run; }
  directory(run) { try { return this.outputs.directory(run); } catch { return ''; } }
  cancelBeforeDelete(run) { return ['failed', 'unknown', 'canceled'].includes(run.status) && this.execution.active?.run?.id !== run.id && run.items.some(item => activeItems.has(item.status)); }
  async files(run) {
    const files = new Map(), skipped = new Set(), shared = new Set();
    const remember = async file => { if (file) shared.add(canonical(await fs.realpath(file).catch(() => file))); };
    for (const other of this.execution.runs) if (other.id !== run.id) {
      for (const item of other.items) for (const output of item.outputs || []) { await remember(output.localPath); await remember(output.namedPath); }
      for (const image of other.keptOutput?.images || []) await remember(path.resolve(other.keptOutput.path, image.file));
    }
    for (const model of this.store.models()) { await remember(model.path); await remember(model.coverPath); }
    for (const album of this.store.get('imageAlbums', [])) for (const image of album.images) await remember(path.join(album.directory, image.file));
    let batch; try { batch = this.outputs.directory(run); } catch {}
    const roots = [this.store.dir, ...(batch ? [batch] : [])];
    const safeFile = async (file, isImage = true) => {
      if (!file || !path.isAbsolute(file) || (isImage && !imageFile(file))) return null;
      try {
        const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) { skipped.add(file); return null; }
        const real = await fs.realpath(file);
        // Both lexical and resolved paths must match, rejecting junctions within
        // managed directories. Never follow a directory link while deleting.
        let valid = false;
        for (const root of roots) if (inside(file, root)) {
          const realRoot = await fs.realpath(root).catch(() => null);
          if (realRoot && canonical(real) === canonical(path.join(realRoot, path.relative(root, file)))) {
            if (batch && canonical(root) === canonical(batch)) {
              const parent = await fs.realpath(path.dirname(batch)).catch(() => null);
              if (!parent || canonical(realRoot) !== canonical(path.join(parent, path.basename(batch)))) continue;
            }
            valid = true; break;
          }
        }
        if (!valid || shared.has(canonical(real)) || (isImage && !await allowedResultPath(this.store, run, file))) { skipped.add(file); return null; }
        return real;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    const add = async (file, isImage = true) => { const real = await safeFile(file, isImage); if (real) files.set(canonical(real), { path: real, image: isImage }); };
    for (const item of run.items) for (const output of item.outputs || []) { await add(output.localPath); await add(output.namedPath); }
    const emptyDirectories = [];
    if (batch) {
      const manifestPath = path.join(batch, '配方流结果.json');
      if ((await readJson(manifestPath))?.runId === run.id) await add(manifestPath, false);
      const kept = path.join(batch, '保留图片');
      for (const entry of await fs.readdir(kept, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^编号-\d+$/.test(entry.name)) continue;
        const directory = path.join(kept, entry.name), manifest = path.join(directory, '保留清单.json');
        if (!await safeFile(manifest, false)) continue;
        const data = await readJson(manifest); if (data?.runId !== run.id || !Array.isArray(data.images)) continue;
        for (const image of data.images) if (typeof image.file === 'string' && path.basename(image.file) === image.file) await add(path.join(directory, image.file));
        await add(manifest, false); emptyDirectories.push(directory);
      }
      emptyDirectories.push(kept, batch);
    }
    return { files: [...files.values()], skipped: skipped.size, emptyDirectories };
  }
  preview(runId) { return this.outputs.exclusive(runId, async () => { const run = this.find(runId), plan = await this.files(run), cancelBeforeDelete = this.cancelBeforeDelete(run); return { runId, name: run.name, kind: run.kind, cancelBeforeDelete, blockedReason: deletionBlock(this.execution, run, { allowCancel: cancelBeforeDelete }), imageCount: plan.files.filter(file => file.image).length, fileCount: plan.files.length, skippedCount: plan.skipped, outputCount: run.items.reduce((total, item) => total + (item.outputs?.length || 0), 0), folderPath: this.directory(run) }; }); }
  remove(runId, { trashFiles = true } = {}) {
    if (typeof trashFiles !== 'boolean') throw new Error('删除选项无效');
    return this.outputs.exclusive(runId, async () => {
      const run = this.find(runId), cancelBeforeDelete = this.cancelBeforeDelete(run), blocked = deletionBlock(this.execution, run, { allowCancel: cancelBeforeDelete }); if (blocked) throw new Error(blocked);
      this.execution.deleting.add(runId); let moved = 0;
      try {
        if (cancelBeforeDelete) {
          try { await this.execution.action(runId, 'cancel', undefined, { forDeletion: true }); }
          catch (error) { throw new Error(`无法取消该批次剩余任务，请确认 ComfyUI 已启动后重试。${error.message}`); }
        }
        const remaining = deletionBlock(this.execution, run, { ignoreDeleting: true }); if (remaining) throw new Error(remaining);
        const plan = trashFiles ? await this.files(run) : null;
        if (trashFiles && typeof this.trashItem !== 'function') throw new Error('当前环境不支持回收站，未删除记录或文件');
        for (const file of plan?.files || []) {
          // Recheck each path after asynchronous work; a replaced link is never
          // passed to the platform recycle operation.
          const stat = await fs.lstat(file.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (!stat) continue;
          if (!stat.isFile() || stat.isSymbolicLink() || canonical(await fs.realpath(file.path)) !== canonical(file.path)) throw new Error('结果文件路径发生变化，已停止删除');
          await this.trashItem(file.path); moved++;
        }
        // Empty folders only: never recursively remove user-added files.
        for (const directory of plan?.emptyDirectories || []) {
          const absolute = path.resolve(directory), parent = await fs.realpath(path.dirname(absolute)).catch(() => null);
          const real = await fs.realpath(absolute).catch(() => null);
          if (parent && real && canonical(real) === canonical(path.join(parent, path.basename(absolute))) && canonical(absolute) === canonical(real)) await fs.rmdir(absolute).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EACCES', 'EPERM'].includes(error.code)) throw error; });
        }
        const previous = this.execution.runs;
        this.execution.runs = previous.filter(item => item.id !== runId);
        try { this.execution.persist(); } catch (error) { this.execution.runs = previous; throw error; }
        return { removed: true, movedCount: moved, skippedCount: plan?.skipped || 0, folderPath: this.directory(run) };
      } catch (error) { throw new Error(`${moved ? `已移入回收站 ${moved} 个文件；` : ''}批次记录仍保留，可重试。${error.message}`); }
      finally { this.execution.deleting.delete(runId); }
    });
  }
}
