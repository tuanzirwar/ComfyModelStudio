import {itemProgress,runProgress} from './generation-progress.mjs';
import {effectiveRecipePrompt} from './character-slot.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createOutputNaming, outputFilename, taskOrder } from './output-naming.mjs';
import { atomicJson, readJson, inside, hashFile } from './utils.mjs';
import { defaultOutputRoot, runOutputRoot, allowedResultPath } from './output-paths.mjs';
import { curationSummary, outputKey, reviewState, selectOutputs, saveNumberedSelection } from './curation.mjs';

// Reuse an identical named copy, but never overwrite a different existing file.
export async function copyOutputExclusive(source, requested) {
  if (!(await fs.stat(source)).isFile()) throw new Error('结果图片不是有效文件');
  if (path.resolve(source).toLowerCase() === path.resolve(requested).toLowerCase()) return requested;
  await fs.mkdir(path.dirname(requested), { recursive: true });
  const ext = path.extname(requested); const stem = requested.slice(0, -ext.length);
  for (let collision = 0; collision < 10000; collision++) {
    const target = collision ? `${stem}__${collision + 1}${ext}` : requested;
    try { await fs.copyFile(source, target, constants.COPYFILE_EXCL); return target; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const [a, b] = await Promise.all([fs.stat(source), fs.stat(target)]);
      if (a.size === b.size && await hashFile(source) === await hashFile(target)) return target;
    }
  }
  throw new Error('输出目录存在过多同名文件，请换一个目录');
}
export class OutputsService {
  constructor(store, execution) { this.store = store; this.execution = execution; this.pending = new Map(); this.mutations = new Map(); }
  root() { return defaultOutputRoot(this.store); }
  naming(run) { return run.outputNaming || createOutputNaming(run, { appRoot: runOutputRoot(this.store, run) }); }
  directory(run) { const root = runOutputRoot(this.store, run), folder = this.naming(run).folderName; const directory = path.resolve(root, folder); if (path.basename(folder) !== folder || !inside(directory, root)) throw new Error('批次输出目录无效'); return directory; }
  mediaPath(run, item, index) { return run && item && Number.isInteger(index) && index >= 0 ? allowedResultPath(this.store, run, item.outputs?.[index]?.localPath) : null; }
  exclusive(runId, action) { const previous = this.mutations.get(runId) || Promise.resolve(); const work = previous.catch(() => {}).then(action); this.mutations.set(runId, work); work.finally(() => { if (this.mutations.get(runId) === work) this.mutations.delete(runId); }).catch(() => {}); return work; }
  selection(runId, choices) { return this.exclusive(runId, () => { const { run } = this.find(runId); const summary = selectOutputs(run, choices); if (summary.changed) this.execution.persist(); return { keptCount: summary.keptCount, pendingCount: summary.pendingCount, discardedCount: summary.discardedCount }; }); }
  renumber(runId, destinationRoot) { return this.exclusive(runId, async () => { const { run } = this.find(runId); const result = await saveNumberedSelection(this.store, run, this.directory(run), { destinationRoot }); if (!destinationRoot) this.execution.persist(); return { path: result.path, count: result.count, version: result.version, reused: result.reused }; }); }
  project() {
    const collections = this.execution.runs.map(run => {
      let naming; try { naming = this.naming(run); } catch { naming = createOutputNaming({ ...run, createdAt: Number.isFinite(new Date(run.createdAt).getTime()) ? run.createdAt : '2000-01-01T00:00:00Z' }); }
      const summary = curationSummary(run);
      return { generationProgress:runProgress(run), id: run.id, name: run.name, createdAt: run.createdAt, status: run.status, folderName: naming.folderName, folderPath: path.join(runOutputRoot(this.store, run), naming.folderName), legacy: !run.outputNaming, outputCount: summary.entries.length, keptCount: summary.keptCount, pendingCount: summary.pendingCount, discardedCount: summary.discardedCount, numberingDirty: summary.numberingDirty, keptOutput: run.keptOutput ? { path: run.keptOutput.path, version: run.keptOutput.version, count: run.keptOutput.count } : null, items: run.items.map(item => ({ id: item.id, order: item.order, taskId: item.taskId, taskOrder: taskOrder(run, item), name: item.name, progress:itemProgress(item), group: item.group, image: item.image, seed: item.seed, status: item.status, attempt: item.attempt || 1, error: item.error, outputs: (item.outputs || []).map((output, index) => ({ index, key: outputKey(item, index), reviewState: reviewState(output), number: summary.numbers.get(outputKey(item, index)) || null, nodeId: output.nodeId, filename: output.namedFilename || outputFilename(naming, run, item, index, path.extname(output.localPath || output.filename)), originalFilename: output.filename, size: output.size, src: `cms-media://result/${run.id}/${item.id}/${index}` })) })) };
    });
    return { root: this.root(), collections };
  }
  find(runId, itemId) {
    const run = this.execution.runs.find(run => run.id === runId); if (!run) throw new Error('未找到生成批次结果');
    const item = itemId ? run.items.find(item => item.id === itemId) : null; if (itemId && !item) throw new Error('未找到配方任务'); return { run, item };
  }
  async details(runId, itemId) {
    const { run, item } = this.find(runId, itemId); const snapshot = await readJson(item.snapshotPath); if (!snapshot) throw new Error('运行快照暂不可用');
    return { flowName: run.name, recipe: snapshot.recipe, models: snapshot.modelFiles, workflowPath: snapshot.sourcePath, bindings: snapshot.bindings, promptId: item.promptId, seed: item.seed, taskOrder: taskOrder(run, item), group: item.group, image: item.image };
  }
  async materialize(runId, destinationRoot) {
    const key = `${runId}:${destinationRoot || ''}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.exclusive(runId, () => this.writeCollection(runId, destinationRoot)).finally(() => this.pending.delete(key)); this.pending.set(key, work); return work;
  }
  async writeCollection(runId, destinationRoot) {
    const { run } = this.find(runId); const naming = this.naming(run); const root = destinationRoot || runOutputRoot(this.store, run);
    const directory = path.join(root, naming.folderName); if (!inside(directory, root)) throw new Error('输出目录无效');
    const summary = curationSummary(run), available = summary.entries;
    if (!available.length) throw new Error('此批次尚无已生成的图片');
    await fs.mkdir(directory, { recursive: true });
    const images = [];
    for (const { item, output, index } of available) {
      if (!await allowedResultPath(this.store, run, output.localPath)) throw new Error('结果图片缺失，或不在应用数据目录及该批次输出目录内，无法整理');
      const filename = output.namedFilename || outputFilename(naming, run, item, index, path.extname(output.localPath));
      if (path.basename(filename) !== filename || /[<>:"/\\|?*\x00-\x1f]/.test(filename)) throw new Error('结果文件名无效');
      const target = path.join(directory, filename); if (!inside(target, directory)) throw new Error('结果文件名超出输出目录');
      const localPath = await copyOutputExclusive(output.localPath, target);
      const snapshot = await readJson(item.snapshotPath);
      images.push({ file: path.basename(localPath), reviewState: reviewState(output), keptNumber: summary.numbers.get(outputKey(item, index)) || null, recipeName: item.name, taskOrder: taskOrder(run, item), group: item.group, image: item.image, seed: item.seed, attempt: item.attempt || 1, promptId: item.promptId, outputNode: output.nodeId, originalFilename: output.filename, prompt: effectiveRecipePrompt(snapshot?.recipe), negative: snapshot?.recipe?.effectiveNegative ?? snapshot?.recipe?.negative ?? '', parameters: snapshot?.recipe?.parameters, checkpointId: snapshot?.recipe?.checkpointId, loras: snapshot?.recipe?.loras, workflow: snapshot ? { filename: path.basename(snapshot.sourcePath || ''), sourceHash: snapshot.sourceHash, bindings: snapshot.bindings } : undefined, models: snapshot?.modelFiles?.map(({ path: ignored, ...model }) => model) });
      if (!destinationRoot) { output.namedFilename = path.basename(localPath); output.namedPath = localPath; }
    }
    await atomicJson(path.join(directory, '配方流结果.json'), { schemaVersion: 1, flowName: run.name, runId: run.id, createdAt: run.createdAt, naming: naming.format, images });
    if (!destinationRoot) { run.outputNaming ||= naming; this.execution.persist(); }
    return { path: directory, count: images.length };
  }
}
