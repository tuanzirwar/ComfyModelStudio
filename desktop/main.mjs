import {RecipeSharing} from './recipe-sharing.mjs';
import {createPathPresentation} from './path-presentation.mjs';
import { RecipeCovers } from './recipe-covers.mjs';
import { applyCharacterSlot, characterSlotIssues } from './character-slot.mjs';
import { savePlanTemplate, loadPlanTemplate, renamePlanTemplate, deletePlanTemplate } from './plan-library.mjs';
import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, safeStorage, session, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { modelInventory } from './inventory.mjs';
import { promptTagSearch, promptTagTranslation, promptTagTranslations } from './prompt-dictionary.mjs';
import { versionCatalog, latestPerBase } from './version-catalog.mjs';
import { reconcileCatalog } from './catalog-cache.mjs';
import { missingBaseRequirements } from './base-requirements.mjs';
import { importCatalogDownloads } from './catalog-handoff.mjs';
import { savePlanDraft } from './plan-draft.mjs';
import { Store, pathsForRoot } from './store.mjs';
import { Library } from './library.mjs';
import { Civitai, sourceOrigin } from './civitai.mjs';
import { Downloads } from './downloads.mjs';
import { duplicateRecipe, saveRecipe, validatePlan, validateRecipe } from './recipes.mjs';
import { exportBackup, prepareBackup, commitBackup } from './backup.mjs';
import { WorkflowService, ExecutionManager } from './execution.mjs';
import { comfyAddress } from './comfy.mjs';
import { OutputsService } from './outputs.mjs';
import { RecordsService } from './records.mjs';
import { ModelRemovalService } from './model-removal.mjs';
import { AlbumsService } from './albums.mjs';
import { loraCategories, rememberCategories, normalizeCategories } from './categories.mjs';
import { electronFetch } from './network.mjs';
import { mediaResponse } from './media-response.mjs';
import { loadCredentials, saveCredentials } from './credentials.mjs';
import { credentialCrypto } from './windows-credentials.mjs';
import { prepareOutputRoot } from './output-paths.mjs';
import { cleanError, inside, readJson, atomicJson, exists } from './utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = app.isPackaged ? path.resolve(path.dirname(process.execPath), '..', '..') : path.resolve(here, '..');
const dataDir=process.env.CMS_DATA_DIR||path.join(app.getPath('appData'),'ComfyModelStudio');
const pathPresentation=createPathPresentation({home:app.getPath('home'),temp:app.getPath('temp'),appData:app.getPath('appData'),builtin:path.join(here,'data','workflows')});
app.setPath('userData', dataDir);
const keyCrypto = credentialCrypto(safeStorage, dataDir);
protocol.registerSchemesAsPrivileged([{ scheme: 'cms-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, store, library, downloads, workflows, execution, outputs, records, albums, modelRemoval, recipeCovers, changeTimer;
let recipeSharing;
const tokens = new Map();
let credentialError = '';
const changed = () => { if(changeTimer)return;changeTimer=setTimeout(()=>{changeTimer=null;if(window&&!window.isDestroyed())window.webContents.send('studio:changed');},160); };
async function snapshot() {
  const settings = store.get('settings');
  return { generationChoices: workflows.generationChoices, downloadQueuePaused: downloads.queuePaused, removedModelCount: store.removedModels().length, loraCategories: loraCategories(store), imageAlbums: albums.project(), baseRequirements: missingBaseRequirements(store.models()), models: store.models(), recipes: store.get('recipes', []), planTemplates: store.get('planTemplates', []), plan: store.get('plan', { name: '', nameSpecified:false, items: [] }), runs: execution.summaries(), automationOutputs: outputs.project(), preparingRun: execution.preparing, connection: workflows.connection, workflowFiles: await workflows.files(), downloads: downloads.jobs.map(({ resume, ...job }) => job), settings, keyError: credentialError, keyConfigured: Boolean(tokens.get(settings.sourceOrigin)), scanning: library.scanning, scanProgress: library.scanProgress, dataDir, version: app.getVersion() };
}
async function persistKeys(next = tokens) { await saveCredentials(path.join(dataDir, 'credentials.bin'), keyCrypto, next, { backupUnreadable: Boolean(credentialError) }); credentialError = ''; }
async function allowedMedia(model) {
  if (!model?.coverPath) return null;
  try { const real = await fs.realpath(model.coverPath); const roots = [...library.roots(), dataDir]; for (const root of roots) { try { if (inside(real, await fs.realpath(root))) return real; } catch {} } } catch {} return null;
}
async function handle(method, payload = {}) {
  switch (method) {
    case 'snapshot': return snapshot();
    case 'scan': void library.scan(); return true;
    case 'choose-directory': { const result = await dialog.showOpenDialog(window, { title: String(payload.title || '选择模型存放目录').slice(0, 80), properties: ['openDirectory', 'createDirectory'], defaultPath: payload.path || project }); return result.canceled ? null : result.filePaths[0]; }
    case 'settings:root-preview': { if(!path.isAbsolute(String(payload.root||'')))throw new Error('请选择 ComfyUI 安装目录');return {...store.get('settings'),comfyRoot:path.resolve(payload.root),paths:pathsForRoot(path.resolve(payload.root),dataDir)}; }
    case 'settings:update': {
      const old = store.get('settings'); const paths = {};const newRoot=String(payload.comfyRoot??old.comfyRoot??'').trim();if(newRoot&&!path.isAbsolute(newRoot))throw new Error('ComfyUI 安装目录需要绝对路径');
      for (const [type, value] of Object.entries(payload.paths || old.paths)) { if(value===''){paths[type]='';continue;} if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${type} 需要有效的绝对路径`); paths[type] = path.resolve(value); }
      if(newRoot)for(const [type,folder]of Object.entries(pathsForRoot(newRoot,dataDir)))if(!paths[type])paths[type]=folder;
      const connections = Number(payload.downloadConnections ?? old.downloadConnections ?? 4); if (![1,2,4,8].includes(connections)) throw new Error('下载连接数应为 1、2、4 或 8');
      const next = { ...old, downloadConnections: connections, paths, comfyRoot:newRoot?path.resolve(newRoot):'', sourceOrigin: sourceOrigin(payload.sourceOrigin || old.sourceOrigin), comfyAddress: comfyAddress(payload.comfyAddress || old.comfyAddress), defaultWorkflowPath: payload.defaultWorkflowPath || old.defaultWorkflowPath, workflowDirectory: payload.workflowDirectory || old.workflowDirectory }; if (payload.automationOutputDirectory !== undefined) next.automationOutputDirectory = await prepareOutputRoot(store, payload.automationOutputDirectory); if (!path.isAbsolute(next.defaultWorkflowPath) || !next.defaultWorkflowPath.toLowerCase().endsWith('.json')) throw new Error('默认工作流需要 JSON 文件的绝对路径'); store.set('settings', next); changed(); return next;
    }
    case 'key:save': { const origin = sourceOrigin(payload.origin); const token = String(payload.key || '').trim(); if (!/^[A-Za-z0-9_.-]{16,256}$/.test(token)) throw new Error('API Key 格式不正确'); const next = new Map(tokens); next.set(origin, token); await persistKeys(next); tokens.set(origin, token); changed(); return true; }
    case 'key:remove': { const next = new Map(tokens); next.delete(sourceOrigin(payload.origin)); await persistKeys(next); tokens.delete(sourceOrigin(payload.origin)); changed(); return true; }
    case 'acquisition:preview': { const bundle = await library.api.resolve(payload); return { origin: bundle.origin, modelId: bundle.model.id, versionId: bundle.version.id, versions: versionCatalog(bundle.model), name: bundle.model.name, versionName: bundle.version.name, baseModel: bundle.version.baseModel, type: bundle.model.type, files: bundle.files.map(({ id, name, sizeKB, metadata, primary }) => ({ id, name, sizeKB, metadata, primary })), imageCount: bundle.images.length }; }
    case 'download:create': return downloads.create(payload);
    case 'download:bundle': { const bundle = await library.api.resolve({ modelId: payload.modelId, origin: payload.origin }); const versions = latestPerBase(versionCatalog(bundle.model)); const results = []; for (const version of versions) { try { const job = await downloads.create({ origin: bundle.origin, versionId: version.id, fileId: version.fileId, loraCategories: payload.loraCategories || [] }); results.push({ versionId: version.id, reused: Boolean(job.reused), ok: true }); } catch (error) { results.push({ versionId: version.id, ok: false, error: cleanError(error) }); } } return { results }; }
    case 'download:action': await downloads.action(payload.id, payload.action); return true;
    case 'download:bulk': return downloads.bulk(payload.action);
    case 'model:edit': return library.edit(payload.id, payload.changes);
    case 'model:delete-preview': return modelRemoval.preview(payload.id);
    case 'model:delete': return modelRemoval.remove(payload.id, { mode: payload.mode ?? 'trash', expectedPath: payload.expectedPath, revision: payload.revision });
    case 'model:removed': return modelRemoval.removed();
    case 'model:restore': return modelRemoval.restore(payload.id);
    case 'lora-category:create': { const labels = normalizeCategories([payload.name]); rememberCategories(store, labels); changed(); return labels[0]; }
    case 'model:enrich': return library.withModel(payload.id, async () => { const { bundle, file, localPath } = await library.enrich(payload.id); const cover = await downloads.cover(bundle, localPath); const model = await library.archive(localPath, bundle, file, bundle.images[0]?.url || '', cover.path); return { model, coverError: cover.error }; });
    case 'model:cover': return library.withModel(payload.id, async () => {
      const model = store.model(payload.id); if (!model || model.missing) throw new Error('模型文件不可用');
      const selection = await dialog.showOpenDialog(window, { title: '选择本地封面', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif'] }], properties: ['openFile'] }); if (selection.canceled) return false;
      const from = selection.filePaths[0]; if ((await fs.stat(from)).size > 30 * 1024 * 1024) throw new Error('封面超过 30 MB');
      const target = path.join(`${model.path}.cms`, `cover${path.extname(from).toLowerCase()}`); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(from, target); store.upsert({ ...model, coverPath: target, coverRevision: Date.now() }); changed(); return true;
    });
    case 'model:reveal': { const model = store.model(payload.id); if (model) shell.showItemInFolder(model.path); return true; }
    case 'recipe:cover-choose': { const result = await dialog.showOpenDialog(window, { title: '选择配方效果展示图', filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp'] }], properties: ['openFile'] }); return result.canceled ? null : recipeCovers.importFile(result.filePaths[0]); }
    case 'recipe:cover-output': return outputs.exclusive(payload.runId, async () => { const {run,item} = outputs.find(payload.runId,payload.itemId); const file = await outputs.mediaPath(run,item,Number(payload.index)); if (!file) throw new Error('生成图片已删除或暂时不可用'); return recipeCovers.importFile(file); });
    case 'recipe-share:preview': return recipeSharing.preview(payload.id);
    case 'recipe-share:export': return recipeSharing.export(payload.token);
    case 'recipe-share:open': return recipeSharing.open();
    case 'recipe-share:import': {const recipe=recipeSharing.load(payload);changed();return recipe;}
    case 'recipe:duplicate': { const copy=duplicateRecipe(store,payload.id);changed();return copy; }
    case 'recipe:save': { const recipe = saveRecipe(store, payload); changed(); return recipe; }
    case 'recipe:delete': { store.set('recipes', store.get('recipes', []).filter(r => r.id !== payload.id)); const plan = store.get('plan'); if (plan) store.set('plan', { ...plan, updatedAt: new Date().toISOString(), items: plan.items.filter(i => i.recipeId !== payload.id) }); changed(); return true; }
    case 'appearance:set': { if (!['aurora','obsidian','pearl'].includes(payload.theme)) throw new Error('未知主题'); store.set('settings', { ...store.get('settings'), uiTheme: payload.theme }); changed(); return true; }
    case 'plan-template:save': { const saved = savePlanTemplate(store, payload); changed(); return saved; }
    case 'plan-template:load': return loadPlanTemplate(store, payload.id);
    case 'plan-template:rename': { const saved = renamePlanTemplate(store, payload.id, payload.name); changed(); return saved; }
    case 'plan-template:delete': { const result = deletePlanTemplate(store, payload.id); changed(); return result; }
    case 'plan:save': { const plan = validatePlan(payload, store.get('recipes', [])); for (const item of plan.items) { const raw = { ...item.recipeSnapshot, ...item.overrides }, models = store.models(); const issues = characterSlotIssues(raw, plan.characterSlot, models); if (item.enabled && issues.length) throw new Error(issues.join('；')); validateRecipe(applyCharacterSlot(raw, plan.characterSlot, models), models); } store.set('plan', plan); changed(); return plan; }
    case 'plan:autosave': { const draft = savePlanDraft(store, payload); changed(); return draft; }
    case 'prompt:translate-many': return promptTagTranslations(payload.texts);
    case 'prompt:translate': return promptTagTranslation(String(payload.text || '').slice(0, 400));
    case 'prompt:search': return promptTagSearch(String(payload.query || '').slice(0, 100), payload.offset);
    case 'comfy:test': await workflows.probe(payload.address); return workflows.connection;
    case 'workflow:inspect': return workflows.inspect(payload.path);
    case 'workflow:check': return workflows.preview(payload);
    case 'workflow:choose': { const result = await dialog.showOpenDialog(window, { title: '选择 ComfyUI 工作流（界面或 API JSON）', defaultPath: payload.path || workflows.defaultPath(), filters: [{ name: 'ComfyUI JSON', extensions: ['json'] }], properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0]; }
    case 'run:recipe': return execution.start({ recipe: payload });
    case 'run:plan': return execution.start({ plan: payload });
    case 'run:action': return execution.action(payload.runId, payload.action, payload.itemId);
    case 'run:delete-preview': return records.preview(payload.runId);
    case 'run:delete': return records.remove(payload.runId, { trashFiles: payload.trashFiles ?? true });
    case 'output:details': return outputs.details(payload.runId, payload.itemId);
    case 'output:selection': return outputs.selection(payload.runId, payload.choices);
    case 'output:renumber': return outputs.renumber(payload.runId);
    case 'output:publish': return albums.publish(payload.runId, payload.name);
    case 'album:delete': return albums.remove(payload.id, { trashFiles: payload.trashFiles ?? false });
    case 'album:folder': { const album = albums.find(payload.id); const error = await shell.openPath(album.directory); if (error) throw new Error(error); return true; }
    case 'album:reveal': { const file = await albums.media(albums.find(payload.id), payload.index); if (file) shell.showItemInFolder(file); return true; }
    case 'output:directory': { const directory = await prepareOutputRoot(store, payload.path); store.set('settings', { ...store.get('settings'), automationOutputDirectory: directory }); changed(); return directory; }
    case 'output:kept-folder': { const { run } = outputs.find(payload.runId); if (!run.keptOutput?.path) throw new Error('请先点击重新编号并保存'); const error = await shell.openPath(run.keptOutput.path); if (error) throw new Error(error); return true; }
    case 'output:kept-export': { const selection = await dialog.showOpenDialog(window, { title: '选择保留图片导出位置', defaultPath: outputs.root(), properties: ['openDirectory', 'createDirectory'] }); if (selection.canceled) return false; return outputs.renumber(payload.runId, selection.filePaths[0]); }
    case 'output:folder': { const result = await outputs.materialize(payload.runId); const error = await shell.openPath(result.path); if (error) throw new Error(error); return result; }
    case 'output:export': { const selection = await dialog.showOpenDialog(window, { title: '选择配方流结果导出位置', defaultPath: project, properties: ['openDirectory', 'createDirectory'] }); if (selection.canceled) return false; return outputs.materialize(payload.runId, selection.filePaths[0]); }
    case 'run:reveal': { const run = execution.runs.find(run => run.id === payload.runId); const item = run?.items.find(item => item.id === payload.itemId); const file = payload.snapshot ? (item?.snapshotPath && inside(item.snapshotPath, dataDir) ? item.snapshotPath : null) : await outputs.mediaPath(run, item, payload.index || 0); if (file) shell.showItemInFolder(file); return true; }
    case 'external:open': { const u = new URL(payload.url); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('不支持的链接'); await shell.openExternal(u.href); return true; }
    case 'inventory:export': { const result = await dialog.showSaveDialog(window, { title: '备份模型清单', defaultPath: path.join(project, '本地模型清单.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled) return false; await fs.writeFile(result.filePath, modelInventory(store.models()), 'utf8'); return true; }
    case 'backup:export': {
      const result = await dialog.showSaveDialog(window, { title: '导出资料备份（不包含模型权重和密钥）', defaultPath: path.join(project, `模序备份-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return false;
      await atomicJson(result.filePath, exportBackup(store)); return true;
    }
    case 'backup:import': {
      const result = await dialog.showOpenDialog(window, { title: '导入资料备份', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] }); if (result.canceled) return false;
      const file = result.filePaths[0]; if ((await fs.stat(file)).size > 50 * 1024 * 1024) throw new Error('备份过大'); const prepared = prepareBackup(store, await readJson(file));
      await atomicJson(path.join(dataDir, 'backups', `before-import-${Date.now()}.json`), exportBackup(store));
      for (const model of prepared.models) model.missing = !(await exists(model.path));
      commitBackup(store, prepared); changed(); return true;
    }
    default: throw new Error('不支持的操作');
  }
}
function createWindow() {
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 720, minHeight: 580, backgroundColor: '#10141d', title: '模序 · Comfy Model Studio', autoHideMenuBar: true, show: false, icon: path.join(project, 'assets', 'icon.png'), webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.webContents.on('did-fail-load', (_event, code, description) => { void fs.appendFile(path.join(dataDir, 'app-errors.log'), `Load failure ${code}: ${description}\n`); window.show(); });
  window.webContents.on('render-process-gone', (_event, details) => { void fs.appendFile(path.join(dataDir, 'app-errors.log'), `Renderer: ${details.reason}\n`); });
  window.loadFile(path.join(here, '..', 'dist', 'index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    store = new Store(dataDir);
    await reconcileCatalog(store);
    await importCatalogDownloads(store);
    const initialSettings = store.get('settings');if(initialSettings.comfyRoot===path.join(dataDir,'ComfyUI')){const obsolete=initialSettings.comfyRoot;initialSettings.comfyRoot='';for(const [type,folder]of Object.entries(initialSettings.paths))if(String(folder).startsWith(obsolete)||String(folder).startsWith(path.join(dataDir,'imports')))initialSettings.paths[type]='';}const bundled=path.join(here,'data','workflows');if((initialSettings.workflowDirectory||'').includes('app.asar'))initialSettings.workflowDirectory=bundled;if((initialSettings.defaultWorkflowPath||'').includes('app.asar'))initialSettings.defaultWorkflowPath=path.join(bundled,'basic-text-to-image.json'); const workflowDirectory = initialSettings.workflowDirectory || bundled; store.set('settings', { ...initialSettings, comfyAddress: initialSettings.comfyAddress || 'http://127.0.0.1:8188', workflowDirectory, defaultWorkflowPath: initialSettings.defaultWorkflowPath || path.join(workflowDirectory,'basic-text-to-image.json') });
    { const file = path.join(dataDir, 'credentials.bin'); const loaded = await loadCredentials(file, keyCrypto); for (const [origin, token] of loaded.tokens) tokens.set(origin, token); credentialError = loaded.error; if (process.platform === 'win32' && tokens.size && !credentialError && !(await fs.readFile(file)).subarray(0, 12).equals(Buffer.from('CMS-DPAPI-1\0'))) { try { await persistKeys(); } catch { credentialError = '密钥已读取，但迁移本机加密格式失败，请重新保存密钥。'; } } }
    const api = new Civitai({ fetcher: electronFetch(net), token: origin => tokens.get(origin) || '' });
    library = new Library(store, api, changed); downloads = new Downloads(store, api, library, changed);
    workflows = new WorkflowService(store, { fetcher: electronFetch(net) }, changed); execution = new ExecutionManager(store, workflows, changed); outputs = new OutputsService(store, execution); records = new RecordsService(store, execution, outputs, { trashItem: file => shell.trashItem(file) }); albums = new AlbumsService(store, execution, outputs, { trashItem: file => shell.trashItem(file) }); modelRemoval = new ModelRemovalService(store, library, downloads, execution, { trashItem: file => shell.trashItem(file) });
    recipeCovers = new RecipeCovers(store,{validateImage:file=>!nativeImage.createFromPath(file).isEmpty()});
    recipeSharing=new RecipeSharing(store,{
      openFile:async()=>{const selected=await dialog.showOpenDialog(window,{title:'加载配方',filters:[{name:'模序配方',extensions:['json']}],properties:['openFile']});return selected.canceled?null:selected.filePaths[0];},
      saveFile:async filename=>{const selected=await dialog.showSaveDialog(window,{title:'分享配方',defaultPath:path.join(app.getPath('downloads'),filename),filters:[{name:'模序配方',extensions:['json']}]});return selected.canceled?null:selected.filePath;}
    });
    protocol.handle('cms-media', async request => { const u = new URL(request.url); const segments = u.pathname.split('/').filter(Boolean); let file; if (u.hostname === 'recipe-cover') { file = await recipeCovers.media(segments[0]); } else if (u.hostname === 'result') { const run = execution.runs.find(run => run.id === segments[0]); const item = run?.items.find(item => item.id === segments[1]); file = await outputs.mediaPath(run, item, Number(segments[2])); } else if (u.hostname === 'album') { try { file = await albums.media(albums.find(segments[0]), Number(segments[1])); } catch {} } else { file = await allowedMedia(store.model(segments[0])); } return file ? mediaResponse(file) : new Response('', { status: 404 }); });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ipcMain.handle('studio:call', async (event, method, payload) => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('非法调用来源'); try { return pathPresentation.display(await handle(method, pathPresentation.resolve(payload))); } catch (error) { throw new Error(pathPresentation.text(cleanError(error))); } });
    createWindow(); void library.scan(); void downloads.pump(); if(store.get('settings').comfyRoot)void workflows.probe().catch(() => {});
  }).catch(error => { dialog.showErrorBox('模序启动失败', pathPresentation.text(cleanError(error))); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { execution?.close(); for (const controller of downloads?.controllers.values() || []) controller.abort(); });
}
