import { parallelTransfer, cleanupParallelParts, PARALLEL_THRESHOLD } from './parallel-download.mjs';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { id, safeName, exists, hashFile, cleanError, atomicJson, inside, readJson } from './utils.mjs';
import { normalizedMetadata, previewAllowed } from './civitai.mjs';
import { normalizePageDetails } from './details.mjs';
import { normalizeCategories, isLora } from './categories.mjs';

const PAUSABLE = new Set(['queued', 'resolving', 'downloading', 'verifying', 'archiving']);
const RESUMABLE = new Set(['paused', 'failed', 'partial']);
export function queueSpaceNeeded(jobs, destination, bytes) {
  const volume = path.parse(path.resolve(destination)).root.toLowerCase();
  return bytes + jobs.filter(j => j.destination && path.parse(path.resolve(j.destination)).root.toLowerCase() === volume && !j.modelComplete && !['failed','canceled','complete'].includes(j.status)).reduce((sum,j) => sum + Math.max(0, Number(j.total || 0) - Number(j.received || 0)), 0);
}

async function singleTransfer({ api, url, destination, origin, signal, onProgress = () => {}, image = false, resume = {}, expectedHash = '' }) {
  const part = `${destination}.part`;
  let offset = 0;
  try { offset = (await fs.stat(part)).size; } catch {}
  const headers = {};
  if (offset && (resume.etag || resume.lastModified)) { headers.Range = `bytes=${offset}-`; headers['If-Range'] = resume.etag || resume.lastModified; } else offset = 0;
  let response = await api.request(url, { origin, signal, headers, image, auth: !image });
  if (response.status === 416) { await response.body?.cancel(); offset = 0; response = await api.request(url, { origin, signal, image, auth: !image }); }
  if (response.status !== 206) offset = 0;
  if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) { await response.body?.cancel(); throw new Error('服务器返回的续传位置不正确，请重试'); }
  const total = Number(response.headers.get('content-length')) + offset || 0;
  if (image && total > 30 * 1024 * 1024) { await response.body?.cancel(); throw new Error('封面超过 30 MB'); }
  const etag = response.headers.get('etag'); const lastModified = response.headers.get('last-modified');
  const type = response.headers.get('content-type') || '';
  if (image && !/^image\/(jpeg|png|webp|avif)/i.test(type)) { await response.body?.cancel(); throw new Error('缩略图响应不是支持的静态图片'); }
  if (!image && /text\/html|application\/json/i.test(type)) { await response.body?.cancel(); throw new Error('网站返回了页面或错误内容，而非模型文件'); }
  if (!response.body) throw new Error('下载响应为空');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const free = await fs.statfs(path.dirname(destination));
  if (total && free.bavail * free.bsize < total - offset + 10 * 1024 * 1024) { await response.body.cancel(); throw new Error('目标磁盘剩余空间不足'); }
  const stream = createWriteStream(part, { flags: offset ? 'a' : 'w' });
  const streamFinished = new Promise((resolve, reject) => { stream.once('finish', resolve); stream.once('error', reject); });
  const streamClosed = new Promise(resolve => stream.once('close', resolve));
  streamFinished.catch(() => {});
  let received = offset; let last = 0;
  onProgress({ received, total, etag, lastModified });
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted(); received += chunk.length;
      if (image && received > 30 * 1024 * 1024) throw new Error('封面超过 30 MB');
      if (!stream.write(Buffer.from(chunk))) await once(stream, 'drain');
      if (Date.now() - last > 250) { onProgress({ received, total, etag, lastModified }); last = Date.now(); }
    }
    stream.end(); await streamFinished;
  } catch (error) {
    // Flush bytes already accepted by the writer before publishing a paused
    // state. Destroying immediately can drop buffered data reported as received.
    if (!stream.destroyed && !stream.writableEnded) stream.end();
    await streamFinished.catch(() => {}); await streamClosed;
    await response.body?.cancel().catch(() => {}); throw error;
  }
  if (total && received !== total) throw new Error('文件长度不完整，请重试续传');
  if (expectedHash) { onProgress({ received, total, verifying: true, etag, lastModified }); const actual = await hashFile(part, signal); if (actual !== expectedHash.toUpperCase()) { await fs.rename(part, `${part}.invalid-${Date.now()}`); throw new Error('SHA256 校验失败，损坏文件已隔离，请重新下载'); } }
  if (await exists(destination)) throw new Error('目标文件在下载过程中出现，已保留临时文件以避免覆盖');
  signal?.throwIfAborted(); await fs.rename(part, destination); onProgress({ received, total, etag, lastModified });
  return { destination, type, received };
}
export async function transfer(options) {
  const connections = [1,2,4,8].includes(Number(options.connections)) ? Number(options.connections) : 4;
  const parallel = !options.image && ((connections > 1 && Number(options.expectedSize) >= PARALLEL_THRESHOLD) || await exists(`${options.destination}.cms-parts`));
  if (parallel) {
    const result = await parallelTransfer({ ...options, connections });
    if (result) return result;
  }
  return singleTransfer({ ...options, onProgress: progress => options.onProgress?.({ ...progress, transferMode: 'single', connections: 1 }) });
}
export class Downloads {
  constructor(store, api, library, onChange = () => {}) {
    this.store = store; this.api = api; this.library = library; this.onChange = onChange; this.running = false; this.controllers = new Map(); this.workerDone = new Map(); this.cleanups = new Map(); this.creationTail = Promise.resolve(); this.controlTail = Promise.resolve(); this.queuePaused = Boolean(store.get('downloadQueuePaused', false));
    const saved = store.get('downloads', []), seen = new Set();
    this.jobs = saved.filter(job => !['canceled', 'complete'].includes(job.status)).map(job => ['downloading', 'resolving', 'verifying', 'archiving'].includes(job.status) ? { ...job, status: 'paused', speed: 0, error: '应用已重启，可继续下载' } : this.queuePaused && job.status === 'queued' ? { ...job, status: 'paused', speed: 0 } : job).filter(job => { const key = `${job.key || job.id}|${path.resolve(job.destination || '').toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
    this.persist();
    this.ready = Promise.allSettled(saved.filter(job => job.status === 'canceled').map(job => this.cleanupPart(job))).then(async () => {
      const completed = new Set();
      for (const job of this.jobs) if (job.status === 'partial' && job.modelComplete && await exists(job.destination) && (await readJson(path.join(`${job.destination}.cms`, 'manifest.json')))?.metadata) completed.add(job.id);
      if (completed.size) { this.jobs = this.jobs.filter(job => !completed.has(job.id)); this.persist(); }
    });
  }
  persist() { this.store.set('downloads', this.jobs); this.store.set('downloadQueuePaused', this.queuePaused); this.onChange(); }
  control(operation) { const result = this.controlTail.then(operation); this.controlTail = result.catch(() => {}); return result; }
  bulk(action) {
    if (!['pause', 'start'].includes(action)) return Promise.reject(new Error('不支持的下载批量操作'));
    return this.control(async () => {
      await this.ready;
      if (action === 'pause') {
        this.queuePaused = true;
        const targets = this.jobs.filter(job => PAUSABLE.has(job.status));
        const workers = targets.map(job => this.workerDone.get(job.id)).filter(Boolean);
        // Set every queued state before aborting any worker: the pump must never
        // pick up another member of the batch while the current stream stops.
        for (const job of targets) { job.status = 'paused'; job.speed = 0; job.error = ''; }
        this.persist(); for (const job of targets) this.controllers.get(job.id)?.abort();
        await Promise.all(workers); return { paused: targets.length, queuePaused: true };
      }
      this.queuePaused = false;
      const targets = this.jobs.filter(job => RESUMABLE.has(job.status));
      await Promise.all(targets.map(job => this.workerDone.get(job.id)).filter(Boolean));
      let started = 0;
      for (const job of targets) {
        await this.cleanups.get(job.destination);
        if (this.jobs.includes(job) && RESUMABLE.has(job.status)) { job.status = 'queued'; job.speed = 0; job.error = ''; started++; }
      }
      const queued = this.jobs.filter(job => job.status === 'queued').length;
      this.persist(); void this.pump(); return { started, queued, queuePaused: false };
    });
  }
  create(input) {
    if (this.store.removingModels?.size) return Promise.reject(new Error('模型正在删除，请稍后获取'));
    this.creationPending = (this.creationPending || 0) + 1;
    const operation = this.creationTail.then(() => this.createJob(input));
    this.creationTail = operation.catch(() => {}); return operation.finally(() => { this.creationPending--; });
  }
  async createJob(input) {
    await this.ready;
    const bundle = await this.api.resolve(input);
    const loraCategories = isLora(bundle.model.type) && input.loraCategories !== undefined ? normalizeCategories(input.loraCategories) : undefined;
    bundle.pageDetails = normalizePageDetails(input.pageDetails, bundle);
    const file = bundle.files.find(file => file.id === Number(input.fileId)) || (!input.fileId ? bundle.files.find(file => file.primary) || bundle.files[0] : null);
    if (!file) throw new Error('所选文件不属于当前版本');
    const key = `${bundle.origin}:${bundle.version.id}:${file.id}`;
    const image = input.imageUrl ? bundle.images.find(image => image.url === input.imageUrl) : bundle.images[0];
    const duplicate = this.jobs.find(job => job.key === key);
    if (duplicate && duplicate.status !== 'complete') {
      if (loraCategories !== undefined) duplicate.loraCategories = loraCategories;
      if (bundle.pageDetails.status === 'captured') duplicate.pageDetails = bundle.pageDetails;
      if (image && !this.controllers.has(duplicate.id)) duplicate.imageUrl = image.url;
      if (RESUMABLE.has(duplicate.status)) { if (this.queuePaused) { duplicate.status = 'paused'; duplicate.speed = 0; } else await this.action(duplicate.id, 'retry'); }
      this.persist(); return duplicate;
    }
    const reusable = !this.queuePaused && file.hashes?.SHA256 && this.store.models().find(m => !m.missing && m.sha256?.toUpperCase() === file.hashes.SHA256.toUpperCase());
    if (reusable && await exists(reusable.path) && await hashFile(reusable.path) === file.hashes.SHA256.toUpperCase()) { const cover = reusable.coverPath ? { path: reusable.coverPath, error: '' } : await this.cover(bundle, reusable.path, image?.url); await this.library.archive(reusable.path, bundle, file, image?.url, cover.path, { loraCategories }); return { status: 'complete', reused: true, destination: reusable.path, error: cover.error }; }
    const settings = this.store.get('settings');
    const root = settings.paths[bundle.model.type] || settings.paths.Other;if(!root)throw new Error('请先在设置中选择模型存放目录');
    await fs.mkdir(root, { recursive: true });
    const realRoot = await fs.realpath(root);
    let filename = safeName(file.name); let destination = path.join(realRoot, filename); let modelComplete = false;
    await this.cleanups.get(destination);
    if (!inside(destination, realRoot)) throw new Error('无效的目标文件名');
    if (await exists(destination)) {
      const sameHash = file.hashes?.SHA256 && (await hashFile(destination)) === file.hashes.SHA256.toUpperCase();
      if (sameHash && !this.queuePaused) { const cover = await this.cover(bundle, destination, image?.url); await this.library.archive(destination, bundle, file, image?.url, cover.path, { loraCategories }); return { status: 'complete', reused: true, destination, error: cover.error }; }
      if (sameHash) modelComplete = true;
      else {
        const ext = path.extname(filename); filename = `${path.basename(filename, ext)}__v${bundle.version.id}_${file.id}${ext}`; destination = path.join(realRoot, filename);
        if (await exists(destination)) throw new Error('目标版本文件已存在，请先扫描或核验本地文件后再试');
      }
    }
    const disk = await fs.statfs(realRoot); const required = queueSpaceNeeded(this.jobs, destination, modelComplete ? 0 : Math.round(file.sizeKB * 1024));
    if (disk.bavail * disk.bsize < required + 5 * 1024 ** 3) throw new Error('目标磁盘不足以容纳当前下载队列并保留 5 GB 空间，请修改该类型的下载目录后重试');
    const job = { id: id(), key, origin: bundle.origin, versionId: bundle.version.id, fileId: file.id, name: bundle.model.name, versionName: bundle.version.name, type: bundle.model.type, filename, destination, imageUrl: image?.url || '', pageDetails: bundle.pageDetails, status: 'queued', received: 0, total: Math.round(file.sizeKB * 1024), createdAt: new Date().toISOString(), error: '', resume: {} };
    if (loraCategories !== undefined) job.loraCategories = loraCategories;
    if (modelComplete) { job.modelComplete = true; job.received = (await fs.stat(destination)).size; }
    if (this.queuePaused) job.status = 'paused';
    this.jobs.unshift(job); this.persist(); void this.pump(); return job;
  }
  async cover(bundle, modelFile, imageUrl, signal) {
    const image = bundle.images.find(img => img.url === imageUrl) || bundle.images[0];
    if (!image || !previewAllowed(image.url)) return { path: '', error: '', skipped: true };
    const folder = `${modelFile}.cms`; await fs.mkdir(folder, { recursive: true });
    const temp = path.join(folder, `cover-download-${id()}`);
    try {
      const result = await transfer({ api: this.api, url: image.url, destination: temp, origin: bundle.origin, image: true, signal });
      const ext = /png/i.test(result.type) ? 'png' : /webp/i.test(result.type) ? 'webp' : /avif/i.test(result.type) ? 'avif' : 'jpg';
      const target = path.join(folder, `cover.${ext}`);
      if (await exists(target)) await fs.rm(target);
      await fs.rename(temp, target); return { path: target, error: '' };
    } catch (error) { return { path: '', error: cleanError(error) }; }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); await fs.rm(`${temp}.part`, { force: true }).catch(() => {}); }
  }
  async pump() {
    if (this.running) return; this.running = true;
    try {
      await this.ready;
      let job;
      while ((job = this.jobs.find(item => item.status === 'queued'))) {
        const controller = new AbortController(); this.controllers.set(job.id, controller);
        let finish; const stopped = new Promise(resolve => { finish = resolve; }); this.workerDone.set(job.id, stopped);
        try {
          job.status = 'resolving'; job.error = ''; this.persist();
          const bundle = await this.api.resolve({ origin: job.origin, versionId: job.versionId }, { signal: controller.signal });
          bundle.pageDetails = normalizePageDetails(job.pageDetails, bundle);
          controller.signal.throwIfAborted();
          const file = bundle.files.find(file => file.id === job.fileId); if (!file) throw new Error('文件已从网站移除或不可访问');
          if (!job.modelComplete && file.hashes?.SHA256) {
            const shared = this.store.models().find(m => !m.missing && m.path !== job.destination && m.sha256?.toUpperCase() === file.hashes.SHA256.toUpperCase());
            if (shared && await exists(shared.path) && await hashFile(shared.path, controller.signal) === file.hashes.SHA256.toUpperCase()) { await this.cleanupPart(job); job.destination = shared.path; job.filename = path.basename(shared.path); job.modelComplete = true; job.received = shared.size; }
          }
          if (!job.modelComplete) {
            if (await exists(job.destination)) {
              if (!file.hashes?.SHA256 || await hashFile(job.destination, controller.signal) !== file.hashes.SHA256.toUpperCase()) throw new Error('目标文件已存在且与当前模型不一致，未覆盖原文件');
              job.modelComplete = true; job.received = (await fs.stat(job.destination)).size;
            } else {
              controller.signal.throwIfAborted();
              job.status = 'downloading'; const start = Date.now(); const initial = job.received || 0; this.persist();
              await transfer({ api: this.api, url: file.downloadUrl, destination: job.destination, origin: job.origin, signal: controller.signal, resume: job.resume, connections: this.store.get('settings').downloadConnections ?? 4, expectedSize: Math.round(file.sizeKB * 1024), expectedHash: file.hashes?.SHA256 || '', onProgress: progress => { if (controller.signal.aborted) return; Object.assign(job, { received: progress.received, total: progress.total || job.total, speed: Math.max(0, progress.received - initial) / Math.max(1, (Date.now() - start) / 1000), resume: { etag: progress.etag, lastModified: progress.lastModified }, transferMode: progress.transferMode, connections: progress.connections || 1, phase: progress.merging ? 'merging' : progress.verifying ? 'verifying' : '' }); if (progress.verifying) job.status = 'verifying'; this.persist(); } });
            }
            job.modelComplete = true;
          }
          controller.signal.throwIfAborted(); await cleanupParallelParts(job.destination); job.phase = ''; job.status = 'archiving'; this.persist();
          const cover = await this.cover(bundle, job.destination, job.imageUrl, controller.signal);
          controller.signal.throwIfAborted();
          await this.library.archive(job.destination, bundle, file, job.imageUrl, cover.path, { loraCategories: job.loraCategories });
          controller.signal.throwIfAborted();
          job.status = 'complete'; job.error = ''; job.coverWarning = cover.error || ''; job.speed = 0;
          if (job.status === 'complete') this.jobs = this.jobs.filter(item => item.id !== job.id);
          this.persist();
        } catch (error) { if (controller.signal.aborted && job.status !== 'canceled') { job.status = 'paused'; job.speed = 0; } else if (!['paused', 'canceled'].includes(job.status)) { job.status = 'failed'; job.error = cleanError(error); } this.persist(); }
        finally { this.controllers.delete(job.id); this.workerDone.delete(job.id); finish(); }
      }
    } finally { this.running = false; }
  }
  async cleanupPart(job) {
    if (!job.destination || !path.isAbsolute(job.destination)) return;
    if (this.jobs.some(other => other.id !== job.id && other.destination?.toLowerCase() === job.destination.toLowerCase())) return;
    const root = path.dirname(job.destination), part = path.resolve(`${job.destination}.part`);
    if (!inside(part, root) || path.dirname(part).toLowerCase() !== path.resolve(root).toLowerCase()) return;
    try {
      if ((await fs.realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase()) return;
      await cleanupParallelParts(job.destination);
      const stat = await fs.lstat(part); if (stat.isFile() && !stat.isSymbolicLink()) await fs.unlink(part);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  action(id, action) { return this.control(() => this.applyAction(id, action)); }
  async applyAction(id, action) {
    const job = this.jobs.find(job => job.id === id); if (!job) { if (action === 'cancel') return; throw new Error('下载任务不存在'); }
    if (action === 'pause' && PAUSABLE.has(job.status)) { job.status = 'paused'; job.speed = 0; this.controllers.get(id)?.abort(); }
    else if (action === 'cancel' && job.status !== 'complete') {
      job.status = 'canceled'; const stopped = this.workerDone.get(id); this.controllers.get(id)?.abort();
      const cleanup = Promise.resolve(stopped).then(() => this.cleanupPart(job)); this.cleanups.set(job.destination, cleanup);
      this.jobs = this.jobs.filter(item => item.id !== id); this.persist();
      try { await cleanup; } catch { throw new Error('任务已移除，但临时文件未能清理，请检查文件占用或目录权限'); }
      finally { if (this.cleanups.get(job.destination) === cleanup) this.cleanups.delete(job.destination); }
      void this.pump(); return;
    }
    else if (action === 'retry' && RESUMABLE.has(job.status)) { await this.workerDone.get(id); await this.cleanups.get(job.destination); job.status = 'queued'; job.speed = 0; job.error = ''; }
    this.persist(); void this.pump();
  }
}
