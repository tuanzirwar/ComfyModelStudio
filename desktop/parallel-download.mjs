import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, exists, hashFile, readJson } from './utils.mjs';

export const PARALLEL_THRESHOLD = 16 * 1024 ** 2;
const CHUNK_SIZE = 8 * 1024 ** 2;
class RangeUnsupported extends Error {}
const partDirectory = destination => `${destination}.cms-parts`;
const manifestTemp = name => /^manifest\.json\.[a-f0-9-]{36}\.tmp$/.test(name);
const chunkName = index => `${String(index).padStart(6, '0')}.part`;
const sizeOf = async file => {
  try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('下载临时文件不是普通文件'); return stat.size; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};
async function safeDirectory(destination, create = false) {
  const directory = partDirectory(destination);
  if (create) await fs.mkdir(directory, { recursive: true });
  try {
    const stat = await fs.lstat(directory), parent = await fs.realpath(path.dirname(directory));
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(directory)).toLowerCase() !== path.join(parent, path.basename(directory)).toLowerCase()) throw new Error('分段临时目录路径异常，已停止操作');
    return directory;
  } catch (error) { if (error.code === 'ENOENT' && !create) return null; throw error; }
}
function ownedManifest(manifest, destination) {
  return manifest?.schemaVersion === 1 && manifest.filename === path.basename(destination) && Number.isSafeInteger(manifest.total) && manifest.total > 0 && manifest.chunkSize === CHUNK_SIZE;
}
export async function cleanupParallelParts(destination) {
  const directory = await safeDirectory(destination); if (!directory) return;
  const manifest = await readJson(path.join(directory, 'manifest.json'));
  if (!ownedManifest(manifest, destination)) {
    if (!(await fs.readdir(directory)).length) await fs.rmdir(directory);
    else throw new Error('分段目录缺少有效清单，未删除其中的文件');
    return;
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  // Only files described by our layout are owned. Never recursively remove a
  // computed directory, follow links, or touch arbitrary neighboring files.
  if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink() || !(entry.name === 'manifest.json' || manifestTemp(entry.name) || (/^\d{6,}\.part$/.test(entry.name) && Number(entry.name.split('.')[0]) < Math.ceil(manifest.total / CHUNK_SIZE))))) throw new Error('分段目录包含其他文件，已保留以避免误删');
  for (const entry of entries) if (entry.name !== 'manifest.json') await fs.unlink(path.join(directory, entry.name));
  await fs.unlink(path.join(directory, 'manifest.json')); await fs.rmdir(directory);
}
async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) { const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset); if (!bytesWritten) throw new Error('无法写入模型临时文件'); offset += bytesWritten; }
}
async function copyRange(source, target, start, length, signal) {
  const buffer = Buffer.allocUnsafe(Math.min(512 * 1024, length || 1)); let copied = 0;
  while (copied < length) {
    signal?.throwIfAborted();
    const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, length - copied), start + copied);
    if (!bytesRead) throw new Error('临时分段长度不足');
    await writeAll(target, buffer.subarray(0, bytesRead)); copied += bytesRead;
  }
}
function range(response) {
  const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  return [start,end,total].every(Number.isSafeInteger) && start >= 0 && end >= start && total > end ? { start,end,total } : null;
}
function binary(response) {
  return !/text\/html|application\/json/i.test(response.headers.get('content-type') || '');
}
function strongETag(response) { const etag = response.headers.get('etag') || ''; return etag && !/^W\//i.test(etag) ? etag : ''; }

// null means the caller should use its original single-stream implementation.
export async function parallelTransfer({ api, url, destination, origin, signal, onProgress = () => {}, resume = {}, expectedHash = '', connections = 4 }) {
  const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const request = headers => api.request(url, { origin, signal: AbortSignal.any([combined, AbortSignal.timeout(120000)]), headers: { 'Accept-Encoding': 'identity', ...headers }, auth: true });
  let probe;
  try { probe = await request({ Range: 'bytes=0-0' }); } catch (error) { if (/HTTP (?:400|405|501)/.test(error.message) && !combined.aborted) return null; throw error; }
  const probed = range(probe), etag = strongETag(probe), lastModified = probe.headers.get('last-modified') || '';
  await probe.body?.cancel();
  if (probe.status !== 206 || !probed || probed.start !== 0 || probed.end !== 0 || probed.total < PARALLEL_THRESHOLD || !binary(probe) || (!etag && !expectedHash)) return null;
  const total = probed.total, hash = expectedHash.toUpperCase(), part = `${destination}.part`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const directory = await safeDirectory(destination, true), manifestPath = path.join(directory, 'manifest.json');
  const identity = `${origin || ''}:${new URL(url).pathname}`;
  const manifest = { schemaVersion: 1, filename: path.basename(destination), total, chunkSize: CHUNK_SIZE, hash, etag, lastModified, identity };
  const previous = await readJson(manifestPath);
  if (previous && !ownedManifest(previous, destination)) throw new Error('分段清单损坏，请检查下载临时目录');
  if (previous && ['total','hash','etag','lastModified','identity'].some(key => previous[key] !== manifest[key])) {
    await cleanupParallelParts(destination); await fs.mkdir(directory);
    if (await sizeOf(part)) await fs.unlink(part);
  } else if (!previous) {
    const entries = await fs.readdir(directory);
    for (const name of entries) {
      if (!manifestTemp(name) || !ownedManifest(await readJson(path.join(directory, name)), destination)) throw new Error('分段目录已有其他文件，未覆盖');
      if ((await fs.lstat(path.join(directory, name))).isSymbolicLink()) throw new Error('分段目录路径异常');
      await fs.unlink(path.join(directory, name));
    }
  }
  await atomicJson(manifestPath, manifest);
  const segments = Array.from({ length: Math.ceil(total / CHUNK_SIZE) }, (_, index) => ({ index, start: index * CHUNK_SIZE, length: Math.min(CHUNK_SIZE, total - index * CHUNK_SIZE), file: path.join(directory, chunkName(index)), received: 0 }));
  for (const segment of segments) {
    segment.received = await sizeOf(segment.file);
    if (segment.received > segment.length) throw new Error('临时分段超出预期长度，请取消任务后重试');
  }
  let legacy = await sizeOf(part);
  if (legacy > total || (!previous && legacy && ((resume.etag && etag && resume.etag !== etag) || (resume.lastModified && !resume.etag && lastModified && resume.lastModified !== lastModified) || (!resume.etag && !resume.lastModified && !hash)))) { await fs.unlink(part); legacy = 0; }
  if (legacy === total && hash) {
    onProgress({ received: total, total, etag, lastModified, transferMode: 'parallel', connections: 1, verifying: true });
    if (await hashFile(part, combined) !== hash) { await fs.rename(part, `${part}.invalid-${Date.now()}`); await cleanupParallelParts(destination); throw new Error('SHA256 校验失败，损坏文件已隔离，请重新下载'); }
    if (await exists(destination)) throw new Error('目标文件已存在，未覆盖原模型');
    combined.throwIfAborted(); await fs.rename(part, destination); await cleanupParallelParts(destination);
    onProgress({ received: total, total, etag, lastModified, transferMode: 'parallel', connections: 1 });
    return { destination, received: total, type: probe.headers.get('content-type') || '', transferMode: 'parallel', connections: 1 };
  }
  const received = () => segments.reduce((sum, segment) => sum + segment.received, 0);
  const free = await fs.statfs(path.dirname(destination));
  if (free.bavail * free.bsize < total - received() + CHUNK_SIZE + 10 * 1024 ** 2) throw new Error('目标磁盘空间不足以完成分段下载及合并');
  // Import the contiguous file created by older versions or an interrupted
  // merge. No existing bytes are thrown away just to enable parallel mode.
  if (legacy) {
    const source = await fs.open(part, 'r');
    try {
      for (const segment of segments) {
        const available = Math.max(0, Math.min(segment.length, legacy - segment.start));
        if (available <= segment.received) continue;
        const target = await fs.open(segment.file, 'a');
        try { await copyRange(source, target, segment.start + segment.received, available - segment.received, combined); } finally { await target.close(); }
        segment.received = available;
      }
    } finally { await source.close(); }
    await fs.unlink(part);
  }
  const workers = Math.min(Math.max(1,Math.min(8,Number(connections)||4)), segments.filter(segment => segment.received < segment.length).length || 1);
  let lastProgress = 0;
  const progress = (extra = {}, force = false) => { if (force || Date.now() - lastProgress >= 250) { lastProgress = Date.now(); onProgress({ received: received(), total, etag, lastModified, transferMode: 'parallel', connections: workers, ...extra }); } };
  progress({}, true);
  let next = 0;
  const downloadSegment = async segment => {
    for (let attempt = 0; attempt < 3; attempt++) {
      combined.throwIfAborted();
      let response, target;
      try {
        const start = segment.start + segment.received, end = segment.start + segment.length - 1;
        if (start > end) return;
        response = await request({ Range: `bytes=${start}-${end}`, ...(etag || lastModified ? { 'If-Range': etag || lastModified } : {}) });
        const actual = range(response);
        if (response.status !== 206 || !actual || actual.start !== start || actual.end !== end || actual.total !== total || !binary(response) || (etag && ((strongETag(response) && strongETag(response) !== etag) || (!hash && !strongETag(response)))) || (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== end - start + 1)) throw new RangeUnsupported('服务器未正确支持并发分段，切换单连接');
        if (!response.body) throw new Error('分段下载响应为空');
        target = await fs.open(segment.file, 'a');
        for await (const chunk of response.body) {
          combined.throwIfAborted();
          if (segment.received + chunk.length > segment.length) throw new RangeUnsupported('服务器分段长度异常');
          await writeAll(target, Buffer.from(chunk)); segment.received += chunk.length; progress();
        }
        if (segment.received !== segment.length) throw new Error('分段连接提前结束');
        return;
      } catch (error) {
        if (['ENOSPC','EACCES','EPERM','EIO','EBADF','EROFS'].includes(error.code) || combined.aborted || error instanceof RangeUnsupported || attempt === 2 || /API Key|权限|拒绝访问|频繁|HTTP 4\d\d/.test(error.message)) throw error;
        await delay(300 * 2 ** attempt, undefined, { signal: combined });
      } finally { await target?.close(); await response?.body?.cancel().catch(() => {}); }
    }
  };
  let failure;
  const results = await Promise.allSettled(Array.from({ length: workers }, async () => {
    try { while (next < segments.length) { const segment = segments[next++]; if (segment.received < segment.length) await downloadSegment(segment); } }
    catch (error) { if (!failure) { failure = error; controller.abort(error); } throw error; }
  }));
  if (failure || results.some(result => result.status === 'rejected')) {
    if (failure instanceof RangeUnsupported && !signal?.aborted) { await cleanupParallelParts(destination); return null; }
    throw signal?.aborted ? signal.reason : failure || new Error('分段下载中断');
  }
  progress({ merging: true }, true); combined.throwIfAborted();
  const output = await fs.open(part, 'w');
  try {
    for (const segment of segments) {
      combined.throwIfAborted(); const source = await fs.open(segment.file, 'r');
      try { await copyRange(source, output, 0, segment.length, combined); } finally { await source.close(); }
      // The durable contiguous prefix allows restart even after old segments
      // are reclaimed. Peak merge overhead is one segment, not another model.
      await output.sync(); await fs.unlink(segment.file);
    }
  } finally { await output.close(); }
  combined.throwIfAborted();
  if ((await sizeOf(part)) !== total) throw new Error('分段合并后的模型长度不正确');
  if (hash) {
    progress({ verifying: true }, true);
    if (await hashFile(part, combined) !== hash) { await fs.rename(part, `${part}.invalid-${Date.now()}`); await cleanupParallelParts(destination); throw new Error('SHA256 校验失败，损坏文件已隔离，请重新下载'); }
  }
  if (await exists(destination)) throw new Error('目标文件已存在，未覆盖原模型');
  combined.throwIfAborted(); await fs.rename(part, destination); await cleanupParallelParts(destination); progress({}, true);
  return { destination, type: probe.headers.get('content-type') || '', received: total, transferMode: 'parallel', connections: workers };
}
