import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const TYPE_FOLDERS = { Checkpoint: 'checkpoints', LORA: 'loras', LoCon: 'loras', DoRA: 'loras', TextualInversion: 'embeddings', Hypernetwork: 'hypernetworks', VAE: 'vae', Controlnet: 'controlnet', Upscaler: 'upscale_models', TextEncoder: 'text_encoders', CLIP: 'text_encoders', UNet: 'diffusion_models', CLIPVision: 'clip_vision', Detection: 'ultralytics', LLM: 'LLM', MotionModule: null, VisionLanguage: null, Poses: null, Wildcards: null, Workflows: null, ComfyWorkflows: null, AestheticGradient: null, Other: null };
export function pathsForRoot(comfyRoot,dataDir){return Object.fromEntries(Object.entries(TYPE_FOLDERS).map(([type,folder])=>[type,comfyRoot?(folder?path.join(comfyRoot,'models',folder):path.join(dataDir,'imports',type)):'']));}
export function defaults(dataDir){const comfyRoot=process.env.COMFYUI_ROOT?path.resolve(process.env.COMFYUI_ROOT):'';return {comfyRoot,sourceOrigin:'https://civitai.com',paths:pathsForRoot(comfyRoot,dataDir)};}

export class Store {
  constructor(dir) {
    dir = path.resolve(dir);
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.removingModels = new Set();
    this.db = new DatabaseSync(path.join(dir, 'studio.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, value TEXT NOT NULL);');
    if (!this.get('settings')) this.set('settings', defaults(dir));
    this.db.prepare("DELETE FROM kv WHERE key IN ('bridgeClients','bridgeRequests')").run();
    const settings = this.get('settings');
    if ('port' in settings) { delete settings.port; this.set('settings', settings); }
    if ('downloadBudgetBytes' in settings || 'downloadBudgetBaselinePaths' in settings) {
      delete settings.downloadBudgetBytes; delete settings.downloadBudgetBaselinePaths; this.set('settings', settings);
    }
  }
  get(key, fallback = null) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  set(key, value) { this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); return value; }
  models() { return this.db.prepare('SELECT value FROM models').all().map(row => JSON.parse(row.value)); }
  model(id) { const row = this.db.prepare('SELECT value FROM models WHERE id=?').get(id); return row ? JSON.parse(row.value) : null; }
  removedModels() { return this.get('removedModels', []); }
  isRemoved(file) { const key = path.resolve(file).toLowerCase(); return this.removedModels().some(entry => path.resolve(entry.model.path).toLowerCase() === key); }
  commitModelRemoval(model, mode) {
    this.db.exec('BEGIN');
    try {
      const key = path.resolve(model.path).toLowerCase();
      this.set('removedModels', [{ id: model.id, mode, removedAt: new Date().toISOString(), model }, ...this.removedModels().filter(entry => path.resolve(entry.model.path).toLowerCase() !== key)]);
      this.db.prepare('DELETE FROM models WHERE id=?').run(model.id); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  restoreModel(model) {
    this.db.exec('SAVEPOINT restore_model');
    try { const result = this.upsert(model), key = path.resolve(model.path).toLowerCase(); this.set('removedModels', this.removedModels().filter(entry => path.resolve(entry.model.path).toLowerCase() !== key)); this.db.exec('RELEASE restore_model'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO restore_model; RELEASE restore_model'); throw error; }
  }
  upsert(model) {
    const old = this.db.prepare('SELECT id FROM models WHERE path=?').get(model.path);
    if (old && old.id !== model.id) model = { ...model, id: old.id };
    this.db.prepare('INSERT INTO models(id,path,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,value=excluded.value').run(model.id, model.path, JSON.stringify(model)); return model;
  }
  close() { this.db.close(); }
}
