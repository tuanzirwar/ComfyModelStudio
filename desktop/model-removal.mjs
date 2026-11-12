import fs from 'node:fs/promises';
import path from 'node:path';
import { inside, readJson } from './utils.mjs';

const keyOf = file => path.resolve(file).toLowerCase();
const uses = (recipe, id) => recipe?.checkpointId === id || recipe?.loras?.some(lora => lora.modelId === id);
const unfinished = new Set(['queued', 'submitting', 'remote_queued', 'running', 'archiving', 'unknown']);
const modelExtension = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i;

export class ModelRemovalService {
  constructor(store, library, downloads, execution, { trashItem } = {}) { this.store = store; this.library = library; this.downloads = downloads; this.execution = execution; this.trashItem = trashItem; }
  find(id) { const model = this.store.model(id); if (!model) throw new Error('模型已移除或不存在'); return model; }
  references(model) {
    const recipes = this.store.get('recipes', []).filter(recipe => uses(recipe, model.id));
    const plan = this.store.get('plan');
    const globalRole = plan?.characterSlot?.enabled && uses({loras:plan.characterSlot.loras},model.id);
    const tasks = (plan?.items || []).filter(task => globalRole || uses({ ...task.recipeSnapshot, ...task.overrides }, model.id) || recipes.some(recipe => recipe.id === task.recipeId));
    return { recipes: recipes.map(recipe => ({ id: recipe.id, name: recipe.name })), taskCount: tasks.length };
  }
  async blocked(model) {
    if (this.library.scanning) return '正在扫描模型，请等扫描结束后再删除';
    if (this.library.busyModels?.has(model.id)) return '正在编辑、补全资料或更新封面，请完成后再删除';
    if (this.execution.preparing || this.execution.pendingActions) return '正在准备或调整生成任务，请稍后再删除';
    if (this.downloads.creationPending) return '正在建立下载任务，请稍后再删除';
    if (this.downloads.jobs.some(job => job.destination && keyOf(job.destination) === keyOf(model.path) && !['complete', 'canceled'].includes(job.status))) return '此模型有关联的下载任务，请先在下载中心取消该任务或等待下载完成';
    const names = new Set([model.filename, path.basename(model.path), model.path, ...this.library.roots().filter(root => inside(model.path, root)).map(root => path.relative(root, model.path))].filter(Boolean).map(name => name.replaceAll('\\', '/').toLowerCase()));
    for (const run of this.execution.runs) for (const item of run.items) {
      if (!unfinished.has(item.status) || run.status === 'canceled') continue;
      const snapshot = await readJson(item.snapshotPath);
      const workflowReference = Object.values(snapshot?.prompt || {}).some(node => Object.values(node.inputs || {}).some(value => typeof value === 'string' && names.has(value.replaceAll('\\', '/').toLowerCase())));
      const referenced = snapshot?.modelFiles?.some(file => file.id === model.id || (file.path && keyOf(file.path) === keyOf(model.path))) || uses(snapshot?.recipe, model.id) || workflowReference;
      // Missing snapshots cannot establish that a resumable batch is safe.
      if (referenced || !snapshot) return `未结束的批次“${run.name}”可能仍需使用此模型，请先完成或取消该批次`;
    }
    return '';
  }
  async artifacts(model) {
    const files = []; let bytes = 0;
    const validate = async (target, folder) => {
      let stat; try { stat = await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink() || (folder ? !stat.isDirectory() : !stat.isFile())) throw new Error('模型或资料路径是链接或类型异常，只能移除库记录');
      const real = await fs.realpath(target); let allowed = false;
      for (const root of this.library.roots()) if (inside(target, root) && keyOf(target) !== keyOf(root)) {
        const realRoot = await fs.realpath(root).catch(() => null);
        if (realRoot && keyOf(real) === keyOf(path.join(realRoot, path.relative(root, target)))) { allowed = true; break; }
      }
      if (!allowed) throw new Error('文件不在当前配置的模型目录内，或路径包含目录链接；只能移除库记录');
      const fingerprint = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
      if (folder) {
        const walk = async directory => {
          for (const child of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, child.name), current = await fs.lstat(file);
            if (current.isSymbolicLink() || keyOf(await fs.realpath(file)) !== keyOf(file)) throw new Error('配套资料内包含链接，只能移除库记录');
            if (current.isDirectory()) await walk(file); else if (current.isFile()) bytes += current.size; else throw new Error('配套资料包含特殊文件，只能移除库记录');
          }
        }; await walk(real);
      } else bytes += stat.size;
      files.push({ path: real, folder, fingerprint });
    };
    if (!path.isAbsolute(model.path) || !modelExtension.test(model.path)) throw new Error('模型文件路径无效，只能移除库记录');
    // The user reviews the exact model file and this model's .cms folder.
    // Adjacent preview images and third-party metadata are deliberately retained.
    await validate(`${model.path}.cms`, true); await validate(model.path, false);
    return { files, bytes };
  }
  async preview(id) {
    const model = this.find(id), blockedReason = await this.blocked(model);
    let plan, recycleError = ''; try { plan = await this.artifacts(model); } catch (error) { recycleError = error.message; }
    return { id, name: model.name, path: model.path, type: model.type, size: plan?.bytes || model.size || 0, artifacts: plan?.files.map(file => ({ path: file.path, folder: file.folder })) || [], revision: plan?.files.map(file => ({ path: file.path, ...file.fingerprint })), recycleError, blockedReason, ...this.references(model) };
  }
  async remove(id, { mode = 'trash', expectedPath, revision } = {}) {
    if (!['trash', 'index'].includes(mode)) throw new Error('删除方式无效');
    const model = this.find(id), key = keyOf(model.path); if (this.store.removingModels.has(key)) throw new Error('模型正在删除，请稍候');
    if (expectedPath !== undefined && (typeof expectedPath !== 'string' || keyOf(expectedPath) !== key)) throw new Error('模型路径已变化，请重新打开删除窗口');
    this.store.removingModels.add(key); let moved = 0;
    try {
      const blocked = await this.blocked(model); if (blocked) throw new Error(blocked);
      if (mode === 'trash') {
        if (!this.trashItem) throw new Error('当前环境不支持回收站，文件和记录均未删除');
        const plan = await this.artifacts(model);
        if (revision !== undefined && JSON.stringify(revision) !== JSON.stringify(plan.files.map(file => ({ path: file.path, ...file.fingerprint })))) throw new Error('模型或资料在确认窗口打开后发生变化，请重新打开删除窗口');
        for (const artifact of plan.files) {
          const stat = await fs.lstat(artifact.path);
          const old = artifact.fingerprint;
          if (stat.isSymbolicLink() || keyOf(await fs.realpath(artifact.path)) !== keyOf(artifact.path) || stat.dev !== old.dev || stat.ino !== old.ino || stat.size !== old.size || stat.mtimeMs !== old.mtimeMs) throw new Error('模型或资料在确认后发生变化，请重试');
          // shell.trashItem moves this validated absolute file/folder as one
          // recoverable unit. There is no permanent recursive filesystem delete.
          await this.trashItem(artifact.path); moved++;
        }
      }
      this.store.commitModelRemoval(model, mode); this.library.onChange();
      return { removed: true, mode, movedCount: moved, ...this.references(model) };
    } catch (error) { throw new Error(`${moved ? `已移入回收站 ${moved} 项；` : ''}模型库记录仍保留。${error.message}`); }
    finally { this.store.removingModels.delete(key); }
  }
  async removed() {
    return Promise.all(this.store.removedModels().map(async entry => ({ id: entry.id, name: entry.model.name, path: entry.model.path, type: entry.model.type, mode: entry.mode, removedAt: entry.removedAt, exists: await fs.stat(entry.model.path).then(stat => stat.isFile(), () => false) })));
  }
  async restore(id) {
    const entry = this.store.removedModels().find(entry => entry.id === id); if (!entry) throw new Error('已移除记录不存在');
    if (this.store.removingModels.has(keyOf(entry.model.path)) || this.library.scanning) throw new Error('正在处理模型，请稍后重新收录');
    const key = keyOf(entry.model.path); this.store.removingModels.add(key);
    try {
      const stat = await fs.stat(entry.model.path).catch(() => null); if (!stat?.isFile()) throw new Error('模型文件不存在，请先从 Windows 回收站还原文件，再重新收录');
      const changed = stat.size !== entry.model.size || stat.mtimeMs !== entry.model.modified;
      const coverPath = entry.model.coverPath && await fs.stat(entry.model.coverPath).then(stat => stat.isFile(), () => false) ? entry.model.coverPath : '';
      const model = this.store.restoreModel({ ...entry.model, ...(changed ? { sha256: '', metadataStatus: 'changed' } : {}), coverPath, missing: false, size: stat.size, modified: stat.mtimeMs }); this.library.onChange(); return model;
    } finally { this.store.removingModels.delete(key); }
  }
}
