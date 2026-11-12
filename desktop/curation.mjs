import {effectiveRecipePrompt} from './character-slot.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { taskOrder } from './output-naming.mjs';
import { allowedResultPath } from './output-paths.mjs';
import { atomicJson, readJson, inside, hashFile, exists } from './utils.mjs';

export function outputKey(item, index) { return `${item.id}:${item.attempt || 1}:${index}`; }
export function orderedOutputs(run) {
  return run.items.flatMap(item => (item.outputs || []).map((output, index) => ({ key: outputKey(item, index), item, output, index }))).sort((a, b) => taskOrder(run, a.item) - taskOrder(run, b.item) || (a.item.group || 1) - (b.item.group || 1) || (a.item.image || 1) - (b.item.image || 1) || (a.item.order || 0) - (b.item.order || 0) || a.index - b.index || a.key.localeCompare(b.key));
}
export function reviewState(output) { return ['kept', 'discarded'].includes(output.reviewState) ? output.reviewState : 'pending'; }
export function curationSummary(run) {
  const entries = orderedOutputs(run), kept = entries.filter(entry => reviewState(entry.output) === 'kept');
  const numbers = new Map(kept.map((entry, index) => [entry.key, index + 1]));
  const fingerprint = createHash('sha256').update(JSON.stringify(kept.map(entry => entry.key))).digest('hex');
  return { entries, kept, numbers, fingerprint, keptCount: kept.length, pendingCount: entries.filter(entry => reviewState(entry.output) === 'pending').length, discardedCount: entries.filter(entry => reviewState(entry.output) === 'discarded').length, numberingDirty: Boolean(run.keptOutput && run.keptOutput.fingerprint !== fingerprint) };
}
export function selectOutputs(run, choices) {
  if (!Array.isArray(choices) || choices.length > 10000) throw new Error('图片挑选内容无效');
  const lookup = new Map(orderedOutputs(run).map(entry => [entry.key, entry]));
  const updates = new Map();
  for (const choice of choices) {
    if (!['pending', 'kept', 'discarded'].includes(choice.state)) throw new Error('图片保留状态无效');
    const entry = lookup.get(choice.key); if (!entry) throw new Error('图片结果已改变，请刷新后重新挑选');
    updates.set(choice.key, { entry, state: choice.state });
  }
  let changed = 0;
  for (const { entry, state } of updates.values()) if (reviewState(entry.output) !== state) { entry.output.reviewState = state; changed++; }
  if (changed) run.reviewUpdatedAt = new Date().toISOString();
  return { changed, ...curationSummary(run) };
}
export async function saveNumberedSelection(store, run, batchDirectory, { destinationRoot } = {}) {
  if (['running', 'pausing', 'preparing'].includes(run.status)) throw new Error('请等待当前批次生成结束，或暂停后再保存编号');
  const selection = curationSummary(run);
  if (!selection.kept.length) throw new Error('请先选择至少一张要保留的图片');
  const previous = run.keptOutput;
  if (!destinationRoot && previous?.fingerprint === selection.fingerprint && previous.images?.length === selection.kept.length) {
    let valid = true;
    for (const image of previous.images) {
      const file = path.resolve(previous.path, image.file);
      if (!inside(file, previous.path) || !await exists(file) || await hashFile(file) !== image.sha256) { valid = false; break; }
    }
    if (valid) return { ...previous, reused: true };
  }
  const container = destinationRoot ? path.join(destinationRoot, path.basename(batchDirectory), '保留图片') : path.join(batchDirectory, '保留图片');
  await fs.mkdir(container, { recursive: true }); const realContainer = await fs.realpath(container);
  const stage = await fs.mkdtemp(path.join(realContainer, '.编号中-'));
  const images = [], snapshots = new Map();
  try {
    for (const [index, entry] of selection.kept.entries()) {
      const { item, output } = entry;
      const source = await allowedResultPath(store, run, output.localPath); if (!source) throw new Error(`“${item.name}”的备选图片缺失或不在该批次目录，请先恢复原图`);
      let ext = path.extname(output.localPath).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) throw new Error('不支持此图片格式的编号');
      const number = index + 1, file = `${number}${ext}`, target = path.join(stage, file);
      if (target.length > 245) throw new Error('保留图片目录过长，请选择更短的输出目录');
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      const sha256 = await hashFile(target); if (sha256 !== await hashFile(source)) throw new Error('编号时原图发生变化，请重新保存');
      if (!snapshots.has(item.id)) snapshots.set(item.id, await readJson(item.snapshotPath));
      const snapshot = snapshots.get(item.id);
      if (!snapshot?.recipe) throw new Error('运行快照缺失，无法保存带参数的保留清单，请先恢复该批次快照');
      images.push({ number, file, key: entry.key, sha256, originalFilename: output.namedFilename || output.filename, recipeName: item.name, taskOrder: taskOrder(run, item), group: item.group, image: item.image, seed: item.seed, attempt: item.attempt || 1, promptId: item.promptId, outputNode: output.nodeId, prompt: effectiveRecipePrompt(snapshot?.recipe), negative: snapshot?.recipe?.effectiveNegative ?? snapshot?.recipe?.negative ?? '', parameters: snapshot?.recipe?.parameters, checkpointId: snapshot?.recipe?.checkpointId, loras: snapshot?.recipe?.loras, workflow: snapshot ? { filename: path.basename(snapshot.sourcePath || ''), sourceHash: snapshot.sourceHash, bindings: snapshot.bindings } : undefined, models: snapshot?.modelFiles?.map(({ path: ignored, ...model }) => model) });
    }
    const createdAt = new Date().toISOString();
    await atomicJson(path.join(stage, '保留清单.json'), { schemaVersion: 1, app: 'ComfyModelStudio', runId: run.id, flowName: run.name, createdAt, order: '配方流顺序 → 组次 → 图片 → 输出序号', fingerprint: selection.fingerprint, images });
    let version = destinationRoot ? 1 : (previous?.version || 0) + 1, directory;
    while (version < 100000) {
      directory = path.join(realContainer, `编号-${String(version).padStart(3, '0')}`);
      if (await exists(directory)) { version++; continue; }
      try { await fs.rename(stage, directory); break; }
      catch (error) { if (await exists(directory)) { version++; continue; } throw error; }
    }
    if (version >= 100000) throw new Error('编号版本过多，请选择其他输出目录');
    const result = { path: directory, version, createdAt, fingerprint: selection.fingerprint, count: images.length, images };
    if (!destinationRoot) run.keptOutput = result;
    return result;
  } catch (error) {
    // Only remove our own newly-created staging folder, never prior versions.
    const absolute = path.resolve(stage);
    if (inside(absolute, realContainer) && path.basename(absolute).startsWith('.编号中-')) {
      const real = await fs.realpath(absolute).catch(() => null);
      if (real && inside(real, realContainer)) await fs.rm(absolute, { recursive: true, force: true });
    }
    throw error;
  }
}
