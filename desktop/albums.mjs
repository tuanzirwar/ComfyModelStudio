import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { id, atomicJson, inside, hashFile } from './utils.mjs';
import { outputSegment } from './output-naming.mjs';
import { runOutputRoot } from './output-paths.mjs';
import { curationSummary, saveNumberedSelection } from './curation.mjs';

export function albumName(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f]/.test(value)) throw new Error('请填写 1–80 个字符的图片集名称'); return value.trim(); }
export class AlbumsService {
  constructor(store, execution, outputs, { trashItem } = {}) { this.store = store; this.execution = execution; this.outputs = outputs; this.trashItem = trashItem; }
  all() { return this.store.get('imageAlbums', []); }
  find(albumId) { const album = this.all().find(album => album.id === albumId); if (!album) throw new Error('图片集已删除或不存在'); return album; }
  project() { return this.all().map(({ images, ...album }) => ({ ...album, count: images.length, images: images.map((image, index) => ({ ...image, index, src: `cms-media://album/${album.id}/${index}` })) })); }
  async media(album, index) {
    const image = album?.images?.[index];
    if (!Number.isInteger(index) || index < 0 || !image || path.basename(image.file) !== image.file || !/\.(png|jpe?g|webp|avif)$/i.test(image.file)) return null;
    return this.safeFile(album, path.join(album.directory, image.file));
  }
  async safeFile(album, file) {
    try {
      const root = path.resolve(album.rootPath, '图片集'), directory = path.resolve(album.directory);
      if (!inside(directory, root) || directory === root || !inside(file, directory)) return null;
      const realRoot = await fs.realpath(album.rootPath), expected = path.join(realRoot, path.relative(album.rootPath, file));
      const stat = await fs.lstat(file), real = await fs.realpath(file);
      return stat.isFile() && !stat.isSymbolicLink() && real.toLowerCase() === expected.toLowerCase() ? real : null;
    } catch { return null; }
  }
  publish(runId, name) {
    name = albumName(name);
    return this.outputs.exclusive(runId, async () => {
      const { run } = this.outputs.find(runId), fingerprint = curationSummary(run).fingerprint;
      const existing = this.all().find(album => album.sourceRunId === runId && album.name === name && album.fingerprint === fingerprint);
      if (existing) {
        let valid = true;
        for (let index = 0; index < existing.images.length; index++) { const file = await this.media(existing, index); if (!file || await hashFile(file) !== existing.images[index].sha256) { valid = false; break; } }
        if (valid) return { id: existing.id, name, count: existing.images.length, reused: true };
      }
      const numbered = await saveNumberedSelection(this.store, run, this.outputs.directory(run)); this.execution.persist();
      const rootPath = runOutputRoot(this.store, run), container = path.join(rootPath, '图片集');
      await fs.mkdir(container, { recursive: true });
      if ((await fs.realpath(container)).toLowerCase() !== path.join(await fs.realpath(rootPath), '图片集').toLowerCase()) throw new Error('图片集目录不能是指向其他位置的链接');
      const albumId = id(), directory = path.join(container, `${outputSegment(name, 36)}__${albumId.slice(0, 8)}`), stage = await fs.mkdtemp(path.join(container, '.保存中-'));
      const album = { id: albumId, name, sourceRunId: run.id, flowName: run.name, createdAt: new Date().toISOString(), rootPath, directory, fingerprint, images: structuredClone(numbered.images) };
      try {
        for (const image of album.images) {
          const source = path.resolve(numbered.path, image.file), destination = path.join(stage, image.file);
          if (!inside(source, numbered.path) || path.basename(image.file) !== image.file || !inside(destination, stage)) throw new Error('图片集文件名无效');
          await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
          if (await hashFile(destination) !== image.sha256) throw new Error('保存期间图片发生变化，请重试');
        }
        await atomicJson(path.join(stage, '图片集.json'), { schemaVersion: 1, ...album });
        await fs.rename(stage, directory);
        this.store.set('imageAlbums', [album, ...this.all()]); run.lastAlbumId = album.id; this.execution.persist();
        return { id: album.id, name, count: album.images.length, directory };
      } catch (error) {
        const absolute = path.resolve(stage); const real = await fs.realpath(absolute).catch(() => null), realContainer = await fs.realpath(container);
        if (real && inside(absolute, container) && inside(real, realContainer) && path.basename(absolute).startsWith('.保存中-')) await fs.rm(absolute, { recursive: true, force: true });
        throw error;
      }
    });
  }
  remove(albumId, { trashFiles = false } = {}) {
    if (typeof trashFiles !== 'boolean') throw new Error('删除选项无效');
    return this.outputs.exclusive(`album:${albumId}`, async () => {
      const album = this.find(albumId); let moved = 0;
      if (trashFiles) {
        if (!this.trashItem) throw new Error('当前环境不支持回收站');
        const candidates = [...album.images.map(image => path.join(album.directory, image.file)), path.join(album.directory, '图片集.json')];
        try {
          for (const candidate of candidates) { const file = await this.safeFile(album, candidate); if (file) { await this.trashItem(file); moved++; } else { try { await fs.lstat(candidate); throw new Error('图片集路径已改变，未删除该文件'); } catch (error) { if (error.code !== 'ENOENT') throw error; } } }
        } catch (error) { throw new Error(`已回收 ${moved} 个文件，图片集记录仍保留，可重试。${error.message}`); }
        const directory = path.resolve(album.directory), root = path.resolve(album.rootPath, '图片集');
        if (inside(directory, root) && directory !== root && (await fs.realpath(directory).catch(() => '')).toLowerCase() === directory.toLowerCase()) await fs.rmdir(directory).catch(() => {});
      }
      this.store.set('imageAlbums', this.all().filter(item => item.id !== albumId)); this.execution.onChange(); return { removed: true, movedCount: moved };
    });
  }
}
