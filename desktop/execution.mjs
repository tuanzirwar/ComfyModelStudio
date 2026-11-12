import {applyProgressEvent} from './generation-progress.mjs';
import { applyCharacterSlot, characterSlotIssues } from './character-slot.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ComfyClient, historyState } from './comfy.mjs';
import { readWorkflow, inspectWorkflow, compileWorkflow } from './workflow.mjs';
import { validateRecipe, validatePlan } from './recipes.mjs';
import { id, atomicJson, readJson, hashFile, cleanError } from './utils.mjs';
import { automaticFlowName, createOutputNaming, applyOutputNaming, outputFilename } from './output-naming.mjs';
import { copyOutputExclusive } from './outputs.mjs';
import { prepareOutputRoot, batchOutputDirectory } from './output-paths.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ACTIVE = new Set(['submitting', 'remote_queued', 'running', 'archiving']);
const issuedSeeds = new Set();
export function resolveSeed(parameters, index) {
  if (parameters.seedPolicy === 'random') {
    let seed; do { seed = randomBytes(8).readBigUInt64LE().toString(); } while (issuedSeeds.has(seed));
    issuedSeeds.add(seed); return seed;
  }
  const base = BigInt(parameters.seed || '0'); return (parameters.seedPolicy === 'increment' ? (base + BigInt(index)) % (1n << 64n) : base).toString();
}
export function expandPlan(plan, recipes, models) {
  const checked = validatePlan(plan, recipes); const items = [];
  for (const [taskIndex, task] of checked.items.entries()) {
    if (!task.enabled) continue;
    const raw = { ...task.recipeSnapshot, ...task.overrides };
    const issues = characterSlotIssues(raw, checked.characterSlot, models); if (issues.length) throw new Error(`${raw.name}：${issues.join('；')}`);
    const recipe = validateRecipe(applyCharacterSlot(raw, checked.characterSlot, models), models);
    if (checked.randomizeSeeds) recipe.parameters.seedPolicy = 'random';
    recipe.workflowBindings = { ...(task.overrides.workflowBindings || task.recipeSnapshot.workflowBindings || {}), ...(checked.quickPreview ? { mode: 'core' } : {}) };
    recipe.workflowPath = task.overrides.workflowPath || task.recipeSnapshot.workflowPath || '';
    for (let group = 0; group < task.groups; group++) for (let image = 0; image < task.imagesPerGroup; image++) {
      if (items.length >= 1000) throw new Error('单次编排最多展开 1000 张图片，请拆分为多个批次');
      items.push({ recipe, taskId: task.id, taskOrder: taskIndex + 1, group: group + 1, image: image + 1, seed: resolveSeed(recipe.parameters, group * task.imagesPerGroup + image) });
    }
  }
  if (!items.length) throw new Error('编排中没有启用的任务');
  return items;
}

export class WorkflowService {
  constructor(store, { fetcher = fetch, socketFactory } = {}, onChange = () => {}) { this.store = store; this.fetcher = fetcher; this.socketFactory = socketFactory; this.onChange = onChange; this.connection = { connected: false, message: '尚未检测连接' }; this.hashCache = new Map(); }
  client(address) { return new ComfyClient({ address: address || this.store.get('settings').comfyAddress || 'http://127.0.0.1:8188', fetcher: this.fetcher, socketFactory: this.socketFactory }); }
  defaultPath() { const s = this.store.get('settings'); return s.defaultWorkflowPath || path.join(s.comfyRoot, 'workflow', '常用工作流', '复杂文图流.json'); }
  async modelRoots(stats) {
    const root = this.store.get('settings').comfyRoot;
    if (path.resolve(stats.system?.argv?.[0] || '').toLowerCase() !== path.join(root, 'main.py').toLowerCase()) throw new Error('ComfyUI 服务的安装目录与本工具设置不一致，无法确认模型文件身份');
    const script = `import sys,json,os\nroot=sys.argv[1];launch=json.loads(sys.argv[2]);sys.path.insert(0,root);sys.argv=launch\nimport comfy.options\ncomfy.options.enable_args_parsing()\nimport folder_paths\nfrom comfy.cli_args import args\nfrom utils.extra_config import load_extra_path_config\np=os.path.join(root,'extra_model_paths.yaml')\nif os.path.isfile(p):load_extra_path_config(p)\nfor group in (args.extra_model_paths_config or []):\n for p in group:load_extra_path_config(p)\nif args.output_directory:folder_paths.set_output_directory(os.path.abspath(args.output_directory))\nprint(json.dumps({**{k:folder_paths.get_folder_paths(k) for k in ['checkpoints','diffusion_models','loras']},'output':folder_paths.get_output_directory()},ensure_ascii=False))`;
    try { const { stdout } = await promisify(execFile)(path.join(path.dirname(root), 'python', 'python.exe'), ['-X', 'utf8', '-c', script, root, JSON.stringify(stats.system.argv)], { cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }); return JSON.parse(stdout.trim().split('\n').at(-1)); }
    catch (cause) { throw new Error(`无法读取当前 ComfyUI 的模型搜索路径：${cause.message.slice(0, 180)}`); }
  }
  async files() {
    const s = this.store.get('settings'); const directory = s.workflowDirectory || path.dirname(this.defaultPath()); const found = [];
    try { for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) found.push({ name: entry.name, path: path.join(directory, entry.name) }); } catch {}
    if (!found.some(file => file.path === this.defaultPath())) found.unshift({ name: path.basename(this.defaultPath()), path: this.defaultPath() });
    return found;
  }
  async probe(address) {
    try {
      const result = await this.client(address).probe();
      result.modelRoots = await this.modelRoots(result.stats);
      let targetedInterrupt = false;
      try { const root = this.store.get('settings').comfyRoot; const script = result.stats.system?.argv?.[0]; if (script && path.resolve(script).toLowerCase() === path.join(root, 'main.py').toLowerCase()) { const server = await fs.readFile(path.join(root, 'server.py'), 'utf8'); targetedInterrupt = /prompt_id\s*=\s*json_data\.get\(['"]prompt_id['"]\)/.test(server); } } catch {}
      this.generationChoices = { samplers: result.info.KSampler?.input?.required?.sampler_name?.[0] || [], schedulers: result.info.KSampler?.input?.required?.scheduler?.[0] || [] };
      this.connection = { connected: true, message: '已连接本地 ComfyUI', address: result.address, version: result.stats.system?.comfyui_version, device: result.stats.devices?.[0]?.name, queue: (result.queue.queue_running || []).length + (result.queue.queue_pending || []).length, targetedInterrupt, checkedAt: new Date().toISOString() }; this.onChange();
      return result;
    } catch (error) { this.connection = { connected: false, message: cleanError(error), checkedAt: new Date().toISOString() }; this.onChange(); throw error; }
  }
  async inspect(file) { const { info } = await this.probe(); file ||= this.defaultPath(); return { ...inspectWorkflow(await readWorkflow(file), info), path: file }; }
  async prepare(recipe, context, probe) {
    const s = this.store.get('settings'); const file = recipe.workflowPath || this.defaultPath();
    const workflow = await readWorkflow(file);
    const result = compileWorkflow({ workflow, info: probe.info, recipe, models: this.store.models(), roots: probe.modelRoots, runId: context.runId, itemId: context.itemId, seed: context.seed });
    if (result.issues.length) { const error = new Error(result.issues.map(issue => issue.message).join('\n')); error.issues = result.issues; throw error; }
    for (const model of result.modelFiles) {
      const stat = await fs.stat(model.path); const key = `${model.path}:${stat.size}:${stat.mtimeMs}`;
      let sha256 = this.hashCache.get(key);
      if (!sha256) { sha256 = await hashFile(model.path); this.hashCache.set(key, sha256); }
      if (model.sha256 && model.sha256.toUpperCase() !== sha256) throw new Error(`模型“${model.filename}”内容已更改，请重新扫描并核验`);
      model.sha256 = sha256; model.size = stat.size; model.modified = stat.mtimeMs;
    }
    return { ...result, sourcePath: file, sourceWorkflow: workflow, recipe: { ...structuredClone(recipe), ...result.normalizedPrompts, ...((recipe.promptMode==='blocks-v1'||recipe.promptDefinitions||recipe.characterDefinitions)?{prompt:recipe.prompt,negative:recipe.negative}:{}), effectivePrompt:result.normalizedPrompts.prompt,effectiveNegative:result.normalizedPrompts.negative }, seed: context.seed, environment: { address: probe.address, system: probe.stats.system, devices: probe.stats.devices }, comfyOutputDirectory: probe.modelRoots?.output || path.join(s.comfyRoot, 'output'), preparedAt: new Date().toISOString() };
  }
  async preview(recipe) {
    const checked = validateRecipe(recipe, this.store.models()); checked.workflowBindings = recipe.workflowBindings || {};
    const probe = await this.probe(); const file = checked.workflowPath || this.defaultPath();
    const result = compileWorkflow({ workflow: await readWorkflow(file), info: probe.info, recipe: checked, models: this.store.models(), roots: probe.modelRoots, runId: 'preflight', itemId: 'preview', seed: checked.parameters.seed });
    return { ok: result.issues.length === 0, issues: result.issues, warnings: result.warnings, nodeCount: Object.keys(result.prompt).length, bindings: result.bindings, resolvedBindings: result.resolvedBindings, sourcePath: file };
  }
}

export class ExecutionManager {
  constructor(store, workflows, onChange = () => {}) {
    this.store = store; this.workflows = workflows; this.onChange = onChange; this.busy = false; this.preparing = false; this.active = null; this.closed = false;
    this.runs = store.get('runs', []).map(run => ({ ...run, status: ['running', 'pausing', 'preparing'].includes(run.status) ? 'paused' : run.status, items: run.items.map(item => ACTIVE.has(item.status) ? { ...item, status: 'unknown', error: '应用已重启，继续前将按 prompt_id 对账' } : item) }));
    for (const run of this.runs) for (const item of run.items) if (item.seed != null) issuedSeeds.add(String(item.seed));
    this.persist();
  }
  persist() { this.store.set('runs', this.runs); this.onChange(); }
  summaries() { return this.runs; }
  async start({ recipe, plan }) {
    if (this.store.removingModels?.size) throw new Error('正在删除模型，请稍后启动批次');
    if (this.preparing || this.runs.some(run => ['running', 'pausing'].includes(run.status))) throw new Error('已有批次正在运行，请先暂停或等待完成');
    this.preparing = true; this.onChange();
    try {
      const probe = await this.workflows.probe();
      const definitions = plan ? expandPlan(plan, this.store.get('recipes', []), this.store.models()) : [{ recipe: validateRecipe(recipe, this.store.models()), seed: resolveSeed(recipe.parameters, 0), group: 1, image: 1 }];
      if (!plan) definitions[0].recipe.workflowBindings = recipe.workflowBindings || {};
      const run = { id: id(), name: plan ? String(plan.name || '').trim() || '未命名配方流' : recipe.name, kind: plan ? 'plan' : 'recipe', clientId: id(), address: probe.address, status: 'running', createdAt: new Date().toISOString(), paused: false, cancelRequested: false, items: [] };
      if(plan)Object.assign(run,automaticFlowName(plan,definitions,run.createdAt));
      run.outputRoot = await prepareOutputRoot(this.store, plan?.outputDirectory || undefined);
      run.outputNaming = createOutputNaming(run, { appRoot: run.outputRoot, comfyRoot: probe.modelRoots?.output || path.join(this.store.get('settings').comfyRoot, 'output') });
      for (const [index, definition] of definitions.entries()) {
        const itemId = id(); const item = { id: itemId, order: index + 1, recipeId: definition.recipe.id, name: definition.recipe.name, taskId: definition.taskId, taskOrder: definition.taskOrder || 1, group: definition.group, image: definition.image, seed: definition.seed, status: 'queued', promptId: id(), attempt: 1, progress: { value: 0, max: 0 }, outputs: [] };
        const snapshot = await this.workflows.prepare(definition.recipe, { runId: run.id, itemId, seed: item.seed }, probe);
        applyOutputNaming(snapshot, run, item);
        item.snapshotPath = path.join(this.store.dir, 'runs', run.id, itemId, 'snapshot.json'); await atomicJson(item.snapshotPath, snapshot); run.items.push(item);
      }
      this.runs.unshift(run); this.persist(); void this.pump(); return run;
    } finally { this.preparing = false; this.onChange(); }
  }
  async reconcile(run, item, client) {
    const history = await client.history(item.promptId); if (historyState(history)?.state === 'succeeded' || ['failed', 'canceled'].includes(historyState(history)?.state)) return { history };
    const queue = await client.queue();
    if ([...(queue.queue_pending || []), ...(queue.queue_running || [])].some(entry => entry[1] === item.promptId)) return { found: true };
    return { found: false };
  }
  async archive(run, item, history, client) {
    const state = historyState(history);
    const historyFile = path.join(path.dirname(item.snapshotPath), 'history.json'); await atomicJson(historyFile, history);
    if (state.state !== 'succeeded') { item.status = state.state; item.error = state.error; item.errorNode = state.nodeId; item.finishedAt = new Date().toISOString(); return; }
    item.status = 'archiving'; this.persist();
    const snapshot = await readJson(item.snapshotPath); const allowedOutputs = new Set(snapshot.outputs.map(String));
    const images = state.images.filter(image => allowedOutputs.has(String(image.nodeId)));
    if (!images.length) throw new Error('ComfyUI 已完成，但选定输出节点没有返回图片。请检查保存器的预览选项与输出绑定。');
    const outputs = [];
    for (const [index, image] of images.entries()) {
      const response = await client.fetcher(client.imageURL(image), { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`结果图片获取失败：HTTP ${response.status}`);
      const type = response.headers.get('content-type') || ''; if (!/^image\//.test(type)) { await response.body?.cancel(); throw new Error('结果响应不是图片'); }
      const ext = /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : 'png';
      const naming = snapshot.outputNaming || run.outputNaming;
      const filename = naming ? outputFilename(naming, run, item, index, ext) : `result-${index}.${ext}`;
      const directory = naming ? batchOutputDirectory(this.store, { ...run, outputNaming: run.outputNaming || snapshot.outputNaming }) : path.dirname(item.snapshotPath);
      await fs.mkdir(directory, { recursive: true });
      const requested = path.join(directory, filename); const partial = `${requested}.${id()}.part`;
      const handle = await fs.open(partial, 'w'); let size = 0;
      try { for await (const chunk of response.body) { size += chunk.length; if (size > 128 * 1024 * 1024) throw new Error('单张结果图片超过 128 MB，原始图片仍保留在 ComfyUI 输出目录'); await handle.write(Buffer.from(chunk)); } } finally { await handle.close(); }
      const localPath = await copyOutputExclusive(partial, requested); await fs.unlink(partial);
      outputs.push({ ...image, localPath, ...(naming ? { namedFilename: path.basename(localPath), namedPath: localPath } : {}), index, size });
    }
    item.outputs = outputs; item.status = 'succeeded'; item.finishedAt = new Date().toISOString(); item.error = ''; item.progress = { value: 1, max: 1 };
  }
  async monitor(run, item, client) {
    let failures = 0; let absent = 0;
    while (!this.closed && !['canceled'].includes(item.status)) {
      try {
        const history = await client.history(item.promptId); const state = historyState(history);
        if (state && ['succeeded', 'failed', 'canceled'].includes(state.state)) { await this.archive(run, item, history, client); this.persist(); return; }
        const queue = await client.queue();
        const running = (queue.queue_running || []).some(entry => entry[1] === item.promptId);
        const pending = (queue.queue_pending || []).some(entry => entry[1] === item.promptId);
        if (running || pending) { item.status = running ? 'running' : 'remote_queued'; absent = 0; }
        else if (++absent >= 5) { item.status = 'unknown'; item.error = '历史和队列均未发现该任务，已停止派发以避免重复生图'; this.persist(); return; }
        failures = 0; this.persist();
      } catch (error) { if (++failures >= 5) { item.status = 'unknown'; item.error = cleanError(error); this.persist(); return; } }
      await sleep(1400);
    }
  }
  async pump() {
    if (this.busy || this.closed) return; this.busy = true;
    try {
      const run = this.runs.find(run => run.status === 'running'); if (!run) return;
      const client = this.workflows.client(run.address);
      const stopWatch = client.watch(run.clientId, event => {
        const item = run.items.find(item => item.promptId === event.data?.prompt_id);
        if (!item) return;
        applyProgressEvent(item,event);
        if (event.type === 'execution_error') { item.error = event.data.exception_message; item.errorNode = event.data.node_id; }
        this.persist();
      }, state => { run.socket = state; this.onChange(); });
      try {
        for (const item of run.items) {
          if (this.closed || run.paused || run.cancelRequested) break;
          if (!['queued', 'unknown'].includes(item.status)) continue;
          this.active = { run, item, client };
          if (item.status === 'unknown') {
            const result = await this.reconcile(run, item, client);
            if (result.history) { await this.archive(run, item, result.history, client); this.persist(); }
            else if (result.found) await this.monitor(run, item, client);
            else { run.paused = true; run.status = 'unknown'; item.error = '无法确认之前的提交。请核对 ComfyUI 历史后，显式重试此项。'; this.persist(); break; }
          } else {
            item.status = 'submitting'; item.startedAt = new Date().toISOString(); this.persist();
            const snapshot = await readJson(item.snapshotPath); if (!snapshot?.prompt) throw new Error('运行快照缺失');
            for (const model of snapshot.modelFiles || []) { const stat = await fs.stat(model.path); if (stat.size !== model.size || stat.mtimeMs !== model.modified) throw new Error(`模型“${model.filename}”在批次准备后发生变化，请重新检查后启动新批次`); }
            try {
              const response = await client.submit(snapshot.prompt, item.promptId, run.clientId, snapshot.sourceWorkflow);
              item.promptId = response.prompt_id; item.status = 'remote_queued'; this.persist();
            } catch (error) {
              if (error.httpStatus) { item.status = 'failed'; item.error = cleanError(error); }
              else { const result = await this.reconcile(run, item, client).catch(() => ({})); if (!result.history && !result.found) { item.status = 'unknown'; item.error = '提交响应丢失，无法确认是否入队。未自动重发，以免重复生图。'; } else if (result.history) await this.archive(run, item, result.history, client); }
              this.persist();
            }
            if (['remote_queued', 'submitting'].includes(item.status)) await this.monitor(run, item, client);
          }
          this.active = null;
          if (['failed', 'unknown'].includes(item.status)) { run.paused = true; run.status = item.status === 'unknown' ? 'unknown' : 'failed'; break; }
        }
      } catch (error) { if (this.active?.item) { this.active.item.status = 'failed'; this.active.item.error = cleanError(error); } run.paused = true; run.status = 'failed'; }
      finally {
        stopWatch(); this.active = null;
        if (run.cancelRequested) run.status = 'canceled';
        else if (run.items.every(item => ['succeeded', 'canceled', 'failed', 'superseded'].includes(item.status))) run.status = run.items.some(item => item.status === 'failed') ? 'failed' : 'completed';
        else if (run.paused && !['failed', 'unknown'].includes(run.status)) run.status = 'paused';
        if (['completed', 'canceled'].includes(run.status)) run.finishedAt = new Date().toISOString();
        this.persist();
      }
    } finally { this.busy = false; }
  }
  async action(runId, action, itemId, options = {}) {
    if (this.store.removingModels?.size) throw new Error('正在删除模型，请稍后操作批次');
    this.pendingActions = (this.pendingActions || 0) + 1;
    try { return await this.applyAction(runId, action, itemId, options); } finally { this.pendingActions--; }
  }
  async applyAction(runId, action, itemId, { forDeletion = false } = {}) {
    const run = this.runs.find(run => run.id === runId); if (!run) throw new Error('批次不存在');
    if (this.deleting?.has(runId) && !(forDeletion && action === 'cancel')) throw new Error('该批次正在删除，请稍后操作');
    if (['resume', 'retry'].includes(action) && (this.preparing || this.runs.some(other => other !== run && ['running', 'pausing'].includes(other.status)))) throw new Error('另一批次正在准备或运行，请稍后继续');
    if (action === 'pause') { run.paused = true; run.status = this.active?.run === run ? 'pausing' : 'paused'; }
    else if (action === 'resume') { if (this.busy || this.runs.some(other => other !== run && ['running', 'pausing'].includes(other.status))) throw new Error('当前仍有任务运行，请等待后继续'); run.paused = false; run.cancelRequested = false; run.status = 'running'; }
    else if (action === 'cancel') {
      const current = this.active?.run === run ? this.active : null;
      if (current?.item.status === 'submitting') throw new Error('正在确认提交结果，请稍后取消；任务不会被重复提交');
      if (current || run.items.some(item => ACTIVE.has(item.status) || item.status === 'unknown')) {
        const client = current?.client || this.workflows.client(run.address); const queue = await client.queue(); const own = new Set(run.items.map(item => item.promptId));
        const running = (queue.queue_running || []).filter(entry => own.has(entry[1]));
        if (running.length) { await this.workflows.probe(run.address); if (!this.workflows.connection.targetedInterrupt) throw new Error('该服务未确认支持定向中断，请先暂停后续任务；本工具不会全局中断其他任务'); for (const entry of running) await client.interrupt(entry[1]); }
        for (const entry of queue.queue_pending || []) if (own.has(entry[1])) await client.deletePending(entry[1]);
        for (const item of run.items) if (ACTIVE.has(item.status) || item.status === 'unknown') item.status = 'canceled';
      }
      run.cancelRequested = true; run.paused = true; for (const item of run.items) if (item.status === 'queued') item.status = 'canceled'; if (!current) run.status = 'canceled';
    } else if (action === 'retry') {
      if (this.busy) throw new Error('请等待当前任务停止后重试');
      const original = run.items.find(item => item.id === itemId); if (!original || !['failed', 'unknown', 'canceled'].includes(original.status)) throw new Error('该项不能重试');
      const snapshot = await readJson(original.snapshotPath); if (!snapshot) throw new Error('原始运行快照缺失');
      const item = { ...structuredClone(original), id: id(), promptId: id(), parentItemId: original.id, attempt: (original.attempt || 1) + 1, status: 'queued', outputs: [], progress: { value: 0, max: 0 }, error: '', startedAt: null, finishedAt: null };
      run.outputNaming ||= createOutputNaming(run, { appRoot: path.join(this.store.dir, 'outputs'), comfyRoot: snapshot.comfyOutputDirectory || path.join(this.store.get('settings').comfyRoot, 'output') });
      applyOutputNaming(snapshot, run, item);
      item.snapshotPath = path.join(this.store.dir, 'runs', run.id, item.id, 'snapshot.json'); await atomicJson(item.snapshotPath, snapshot); run.items.splice(run.items.indexOf(original) + 1, 0, item); run.status = 'running'; run.paused = false; run.cancelRequested = false;
      original.previousStatus = original.status; original.status = 'superseded'; original.retriedBy = item.id;
    } else throw new Error('不支持的批次操作');
    this.persist(); if (['resume', 'retry'].includes(action)) void this.pump(); return run;
  }
  close() { this.closed = true; this.persist(); }
}
