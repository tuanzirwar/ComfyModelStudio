import {preprocessRecipePrompts} from './prompt-preprocess.mjs';
import { normalizePrompt, promptSyntaxIssues } from './prompt-syntax.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inside } from './utils.mjs';
import { hasBase, baseLabel } from './base-models.mjs';

const PRIMITIVES = new Set(['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'COMBO', 'AUTOCOMPLETE_TEXT_LORAS']);
const FRONTEND_ONLY = new Set(['Note', 'MarkdownNote', 'Fast Groups Bypasser (rgthree)', 'Reroute', 'PrimitiveNode']);
const isLink = value => Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && Number.isInteger(value[1]);
export const workflowHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function widgetInputs(definition) {
  const result = [];
  for (const group of ['required', 'optional']) {
    const fields = definition?.input?.[group] || {};
    for (const name of definition?.input_order?.[group] || Object.keys(fields)) {
      const [type, options = {}] = fields[name] || [];
      if (!options.forceInput && (Array.isArray(type) || PRIMITIVES.has(type))) result.push({ name, type, options });
    }
  }
  return result;
}

export function uiToPrompt(workflow, info) {
  if (!Array.isArray(workflow?.nodes)) {
    const candidate = workflow?.prompt || workflow;
    if (!candidate || typeof candidate !== 'object' || !Object.values(candidate).some(n => n?.class_type)) throw new Error('文件既不是 ComfyUI 界面工作流，也不是 API 工作流');
    return { prompt: structuredClone(candidate), format: 'api', warnings: [] };
  }
  const nodes = new Map(workflow.nodes.map(n => [String(n.id), n]));
  const links = new Map((workflow.links || []).map(l => Array.isArray(l) ? [l[0], { origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] }] : [l.id, l]));
  const values = new Map(); const warnings = [];
  for (const node of workflow.nodes) {
    const inputs = {}; let cursor = 0;
    const saved = node.widgets_values || [];
    if (!Array.isArray(saved)) Object.assign(inputs, saved);
    else for (const widget of widgetInputs(info[node.type])) {
      let value = saved[cursor++];
      if (value === undefined) value = widget.options.default ?? (Array.isArray(widget.type) ? widget.type[0] : undefined);
      if (value !== undefined) inputs[widget.name] = value;
      if ((widget.options.control_after_generate || /^(seed|noise_seed)$/.test(widget.name)) && ['fixed', 'randomize', 'increment', 'decrement'].includes(saved[cursor])) cursor++;
    }
    values.set(String(node.id), inputs);
  }
  const literal = (node, output) => {
    if (output !== 0) return undefined;
    if (['PrimitiveInt', 'PrimitiveFloat', 'PrimitiveBoolean', 'PrimitiveString', 'PrimitiveNode', 'easy int', 'easy float', 'Seed (rgthree)'].includes(node.type)) return node.widgets_values?.[0];
    return undefined;
  };
  function resolve(linkId, trail = new Set()) {
    const link = links.get(linkId); if (!link) return undefined;
    const node = nodes.get(String(link.origin_id)); if (!node || node.mode === 2) return undefined;
    const key = `${node.id}:${link.origin_slot}`; if (trail.has(key)) throw new Error(`工作流连接出现循环：节点 ${node.id}`);
    const next = new Set(trail).add(key);
    if (node.type === 'Reroute') return resolve(node.inputs?.[0]?.link, next);
    if (node.mode === 4) {
      const output = node.outputs?.[link.origin_slot];
      const connected = (node.inputs || []).filter(input => input.link != null);
      const matching = connected.filter(input => input.type === output?.type || input.type === '*');
      const chosen = matching.find(input => input.name.toLowerCase() === output?.name?.toLowerCase()) || matching[link.origin_slot] || matching[0];
      return chosen ? resolve(chosen.link, next) : undefined;
    }
    if (node.type === 'PrimitiveNode') return literal(node, link.origin_slot);
    if (node.type === 'ImpactSwitch') {
      let select = values.get(String(node.id))?.select;
      const input = node.inputs?.find(i => i.name === 'select');
      if (input?.link != null) {
        const source = links.get(input.link); const parent = nodes.get(String(source?.origin_id));
        const value = parent?.mode !== 4 ? literal(parent || {}, source?.origin_slot) : undefined;
        if (value !== undefined) select = value;
        else if (parent?.mode !== 4) return [String(node.id), link.origin_slot];
      }
      if (Number.isInteger(Number(select))) {
        const chosen = node.inputs?.find(i => i.name === `input${Number(select)}`);
        if (chosen?.link != null) return resolve(chosen.link, next);
      }
    }
    return [String(node.id), Number(link.origin_slot)];
  }
  const prompt = {};
  for (const node of workflow.nodes) {
    if (node.mode === 2 || node.mode === 4 || FRONTEND_ONLY.has(node.type)) continue;
    const inputs = { ...values.get(String(node.id)) };
    for (const input of node.inputs || []) if (input.link != null) { const value = resolve(input.link); if (value !== undefined) inputs[input.name] = value; }
    prompt[String(node.id)] = { class_type: node.type, inputs, _meta: { title: node.title || node.type } };
  }
  warnings.push('界面工作流按当前节点定义转换；旁路节点和静态选择器按已保存状态展开。');
  return { prompt, format: 'ui', warnings };
}

export function prunePrompt(prompt, outputs) {
  const kept = {}; const visiting = new Set();
  const visit = id => {
    id = String(id); if (kept[id]) return; if (visiting.has(id)) throw new Error(`API 工作流有循环：${id}`);
    const node = prompt[id]; if (!node) throw new Error(`节点 ${id} 的上游不存在或已被禁用`);
    visiting.add(id);
    for (const value of Object.values(node.inputs || {})) if (isLink(value)) visit(value[0]);
    visiting.delete(id); kept[id] = node;
  };
  outputs.forEach(visit); return kept;
}

function upstreamOf(prompt, start, classes, visited = new Set()) {
  if (!isLink(start)) return null; const id = String(start[0]); if (visited.has(id)) return null; visited.add(id);
  const node = prompt[id]; if (!node) return null;
  if (classes.includes(node.class_type)) return id;
  for (const value of Object.values(node.inputs || {})) { const found = upstreamOf(prompt, value, classes, visited); if (found) return found; }
  return null;
}
export function detectBindings(prompt, info) {
  const entries = Object.entries(prompt);
  const first = (...types) => entries.find(([, n]) => types.includes(n.class_type))?.[0] || '';
  const sampler = first('KSampler', 'KSamplerAdvanced');
  const positive = upstreamOf(prompt, prompt[sampler]?.inputs.positive, ['CLIPTextEncode']) || first('CLIPTextEncode');
  let negative = upstreamOf(prompt, prompt[sampler]?.inputs.negative, ['CLIPTextEncode']) || '';
  if (negative === positive) negative = '';
  const outputs = entries.filter(([, n]) => info[n.class_type]?.output_node && /SaveImage|Image Saver|PreviewImage/i.test(n.class_type)).map(([id]) => id);
  return { checkpoint: first('CheckpointLoaderSimple', 'CheckpointLoader', 'UNETLoader'), positive, negative, sampler, latent: upstreamOf(prompt, prompt[sampler]?.inputs.latent_image, ['EmptyLatentImage', 'EmptySD3LatentImage']) || first('EmptyLatentImage', 'EmptySD3LatentImage'), lora: upstreamOf(prompt, prompt[sampler]?.inputs.model, ['Lora Loader (LoraManager)', 'LoraLoader']) || '', decode: entries.find(([, n]) => n.class_type === 'VAEDecode' && String(n.inputs.samples?.[0]) === sampler)?.[0] || first('VAEDecode'), outputs, mode: 'full' };
}
export function inspectWorkflow(workflow, info) {
  const converted = uiToPrompt(workflow, info);
  return { format: converted.format, nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : Object.keys(converted.prompt).length, bindings: detectBindings(converted.prompt, info), nodes: Object.entries(converted.prompt).map(([id, n]) => ({ id, type: n.class_type, title: n._meta?.title || n.class_type, output: Boolean(info[n.class_type]?.output_node) })), warnings: converted.warnings, sourceHash: workflowHash(workflow) };
}

function scalarBinding(prompt, nodeId, input, value, semantic = input, visited = new Set()) {
  nodeId = String(nodeId); if (visited.has(`${nodeId}.${input}`)) throw new Error('参数绑定出现循环'); visited.add(`${nodeId}.${input}`);
  const node = prompt[nodeId]; if (!node) throw new Error(`参数绑定的节点 ${nodeId} 不存在`);
  const current = node.inputs[input];
  if (isLink(current)) {
    const sourceId = String(current[0]); const source = prompt[sourceId]; let upstreamInput;
    if (source?.class_type === 'Input Parameters (Image Saver)') upstreamInput = ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'][current[1]];
    else if (source?.class_type === 'easy showAnything') upstreamInput = 'anything';
    else if (['easy int', 'easy float', 'PrimitiveInt', 'PrimitiveFloat'].includes(source?.class_type)) upstreamInput = 'value';
    else if (source?.class_type === 'Seed (rgthree)') upstreamInput = 'seed';
    if (source && upstreamInput && upstreamInput in source.inputs) return scalarBinding(prompt, sourceId, upstreamInput, value, semantic, visited);
  }
  node.inputs[input] = value;
  if (node.class_type === 'Seed (rgthree)' && input === 'seed') replaceReferences(prompt, new Map([[`${nodeId}:0`, value]]));
  return { nodeId, input, semantic };
}

function registeredName(model, inputOptions, configuredRoots) {
  if (!model || model.missing) throw new Error('配方引用的本地模型已缺失');
  const options = Array.isArray(inputOptions?.[0]) ? inputOptions[0] : [];
  if (!options.length && /anima/i.test(model.baseModel || '')) throw new Error('当前 ComfyUI 服务的扩散模型列表为空，尚未加载 Anima 模型目录配置。请重新启动秋叶 ComfyUI 后再运行；刷新模序页面无法替代服务重启。');
  const normalized = options.map(name => String(name).replaceAll('\\', '/'));
  for (const root of configuredRoots) if (inside(model.path, root)) {
    const relative = path.relative(root, model.path).replaceAll('\\', '/');
    const index = normalized.indexOf(relative); if (index >= 0) { const first = configuredRoots.map(root => path.join(root, relative)).find(existsSync); if (first && realpathSync(first).toLowerCase() !== realpathSync(model.path).toLowerCase()) throw new Error(`同名模型“${model.filename}”被更高优先级目录遮挡，请移除歧义后再生成`); return options[index]; }
  }
  const candidates = options.filter(name => path.basename(String(name).replaceAll('\\', '/')) === model.filename);
  if (candidates.length === 1) {
    const relative = String(candidates[0]).replaceAll('\\', '/');
    if (configuredRoots.some(root => path.resolve(root, relative).toLowerCase() === path.resolve(model.path).toLowerCase())) return candidates[0];
  }
  throw new Error(`ComfyUI 尚未识别模型“${model.filename}”的目录。请刷新模型列表或配置 extra_model_paths.yaml。`);
}
function replaceReferences(prompt, replacements, skip = new Set()) {
  for (const [id, node] of Object.entries(prompt)) if (!skip.has(id)) for (const [key, value] of Object.entries(node.inputs || {})) if (isLink(value)) {
    const replacement = replacements.get(`${value[0]}:${value[1]}`); if (replacement !== undefined) node.inputs[key] = structuredClone(replacement);
  }
}
function bindLoras(prompt, bindings, recipe, models, info, roots) {
  const anchor = prompt[bindings.lora]; const cp = prompt[bindings.checkpoint];
  if (!cp) throw new Error('未找到 Checkpoint 绑定，请在工作流设置中指定');
  let model = [String(bindings.checkpoint), 0]; let clip = [String(bindings.checkpoint), 1];
  if (cp.class_type === 'UNETLoader') {
    clip = prompt[bindings.positive]?.inputs.clip;
    if (!isLink(clip)) throw new Error('独立扩散模型需要连接有效的文本编码器');
  }
  const old = new Set();
  if (anchor && ['Lora Loader (LoraManager)', 'LoraLoader'].includes(anchor.class_type)) {
    model = anchor.inputs.model; clip = anchor.inputs.clip || clip;
    old.add(String(bindings.lora));
    if (anchor.class_type === 'LoraLoader') {
      while (isLink(model) && prompt[model[0]]?.class_type === 'LoraLoader') { const node = prompt[model[0]]; old.add(String(model[0])); model = node.inputs.model; clip = node.inputs.clip; }
    }
  }
  const inserted = new Set(); const loaded = [];
  for (const [i, lora] of recipe.loras.entries()) {
    const file = models.find(m => m.id === lora.modelId);
    const name = registeredName(file, info.LoraLoader?.input?.required?.lora_name, roots.loras || roots);
    const id = `cms_lora_${i}`;
    if (prompt[id]) throw new Error('工作流含保留节点名 cms_lora_*，请重命名后再导入');
    prompt[id] = { class_type: 'LoraLoader', inputs: { model, clip, lora_name: name, strength_model: lora.strengthModel, strength_clip: lora.strengthClip }, _meta: { title: `模序 LoRA ${i + 1}: ${file.name}` } };
    inserted.add(id); model = [id, 0]; clip = [id, 1]; loaded.push(file);
  }
  const replacements = new Map();
  if (old.size) for (const id of old) { replacements.set(`${id}:0`, model); replacements.set(`${id}:1`, clip); replacements.set(`${id}:2`, loaded.flatMap(m => m.triggerWords || []).join(', ')); replacements.set(`${id}:3`, loaded.map(m => m.filename).join(', ')); }
  else if (recipe.loras.length) {
    replacements.set(`${bindings.checkpoint}:0`, model);
    if (cp.class_type === 'UNETLoader') {
      const source = prompt[bindings.positive]?.inputs.clip;
      if (isLink(source)) replacements.set(`${source[0]}:${source[1]}`, clip);
    } else replacements.set(`${bindings.checkpoint}:1`, clip);
  }
  replaceReferences(prompt, replacements, inserted);
  old.forEach(id => delete prompt[id]);
  return loaded;
}

export function compileWorkflow({ workflow, info, recipe, models, roots, bindings: overrides = {}, runId, itemId, seed }) {
  const converted = uiToPrompt(workflow, info); const prompt = converted.prompt;
  const bindings = { ...detectBindings(prompt, info), ...overrides, ...(recipe.workflowBindings || {}) };
  if (bindings.sourceHash && bindings.sourceHash !== workflowHash(workflow)) throw new Error('工作流已更改，请重新检查并保存参数绑定');
  for (const role of ['checkpoint', 'positive', 'negative', 'sampler', 'latent']) if (!bindings[role] || !prompt[bindings[role]]) throw new Error(`未找到“${role}”绑定，请在工作流设置中选择节点`);
  const cp = models.find(m => m.id === recipe.checkpointId);
  const checkpoint = prompt[bindings.checkpoint];
  if (/anima/i.test(cp.baseModel || '') && (recipe.parameters.width % 16 || recipe.parameters.height % 16)) throw new Error('Anima 的图片宽高必须是 16 的倍数，请调整配方尺寸');
  for (const lora of recipe.loras) { const selected = models.find(model => model.id === lora.modelId); if (selected?.baseModel && cp.baseModel && !hasBase(selected, cp.baseModel) && /anima/i.test(selected.baseModel) !== /anima/i.test(cp.baseModel) && /anima/i.test(`${selected.baseModel} ${cp.baseModel}`)) throw new Error(`LoRA“${selected.name}”与 Checkpoint 的基础模型不兼容：${baseLabel(selected)} / ${cp.baseModel}。请更换匹配的模型组合。`); }
  if (/anima/i.test(cp.baseModel || '') && checkpoint.class_type === 'CheckpointLoaderSimple' && Object.values(prompt).some(node => Object.values(node.inputs || {}).some(value => isLink(value) && String(value[0]) === String(bindings.checkpoint) && value[1] === 1))) throw new Error('Anima checkpoint 不提供此 SDXL 工作流需要的 CLIP。请为该配方选择 Anima 专用工作流及独立文本编码器；当前工作流可改用 Illustrious/SDXL checkpoint。已在提交前停止，避免 NoneType.clone 报错。');
  const modelInput = checkpoint.class_type === 'UNETLoader' ? 'unet_name' : 'ckpt_name';
  const checkpointRoots = checkpoint.class_type === 'UNETLoader' ? roots.diffusion_models || roots.checkpoints || roots : roots.checkpoints || roots;
  checkpoint.inputs[modelInput] = registeredName(cp, info[checkpoint.class_type]?.input?.required?.[modelInput], checkpointRoots);
  const loras = bindLoras(prompt, bindings, recipe, models, info, roots);
  const processed=preprocessRecipePrompts(recipe);
  const normalizedPrompts = { prompt: normalizePrompt(processed.prompt), negative: normalizePrompt(processed.negative) };
  if (!normalizedPrompts.prompt) throw new Error('整理后正向提示词为空，请填写实际提示词');
  const syntaxIssues = [...processed.blocks.flatMap(block=>promptSyntaxIssues(normalizePrompt(block))), ...promptSyntaxIssues(normalizedPrompts.prompt), ...promptSyntaxIssues(normalizedPrompts.negative)];
  if (syntaxIssues.length) throw new Error(syntaxIssues.join('；'));
  prompt[bindings.positive].inputs.text = normalizedPrompts.prompt;
  prompt[bindings.negative].inputs.text = normalizedPrompts.negative;
  const resolved = [];
  const sampler = prompt[bindings.sampler]; const advanced = sampler.class_type === 'KSamplerAdvanced';
  const p = recipe.parameters;
  for (const [input, value] of [[advanced ? 'noise_seed' : 'seed', String(seed)], ['steps', p.steps], ['cfg', p.cfg], ['sampler_name', p.sampler], ['scheduler', p.scheduler]]) resolved.push(scalarBinding(prompt, bindings.sampler, input, value));
  if ('denoise' in sampler.inputs && (p.denoise != null || bindings.mode === 'core')) resolved.push(scalarBinding(prompt, bindings.sampler, 'denoise', bindings.mode === 'core' ? 1 : Number(p.denoise)));
  for (const [input, value] of [['width', p.width], ['height', p.height], ['batch_size', 1]]) resolved.push(scalarBinding(prompt, bindings.latent, input, value));
  const prefix = `ComfyModelStudio/${runId}/${itemId}`;
  if (bindings.memoryProfile === 'balanced') for (const node of Object.values(prompt)) {
    if (node.class_type === 'SAMLoader') node.inputs.device_mode = 'CPU';
    if (/FaceDetailer/.test(node.class_type)) { node.inputs.guide_size = Math.min(Number(node.inputs.guide_size) || 512, 512); node.inputs.max_size = 768; node.inputs.tiled_encode = true; node.inputs.tiled_decode = true; }
  }
  let outputs = (bindings.outputs || []).filter(id => prompt[id]);
  if (bindings.mode === 'core') {
    const decode = prompt[bindings.decode];
    const vae = decode?.inputs?.vae || (checkpoint.class_type !== 'UNETLoader' ? [String(bindings.checkpoint), 2] : null);
    if (!vae) throw new Error('快速预览需要有效 VAE，请指定主采样解码器或使用匹配的独立 VAE 工作流');
    if (!['EmptyLatentImage', 'EmptySD3LatentImage'].includes(prompt[bindings.latent]?.class_type)) throw new Error('快速预览需要空白潜空间，请选择文生图工作流');
    sampler.inputs.latent_image = [String(bindings.latent), 0];
    if (advanced) Object.assign(sampler.inputs, { add_noise: 'enable', start_at_step: 0, end_at_step: Number(p.steps), return_with_leftover_noise: 'disable' });
    bindings.decode ||= 'cms_quick_decode';
    prompt[bindings.decode] = { class_type: 'VAEDecode', inputs: { samples: [String(bindings.sampler), 0], vae }, _meta: { title: '快速预览 · 基础解码' } };
    prompt.cms_output = { class_type: 'SaveImage', inputs: { images: [String(bindings.decode), 0], filename_prefix: prefix }, _meta: { title: '模序主采样输出' } }; outputs = ['cms_output'];
  }
  if (!outputs.length) throw new Error('未选择有效图片输出节点');
  for (const output of outputs) {
    const node = prompt[output];
    if (node.class_type === 'Image Saver') Object.assign(node.inputs, { filename: `${itemId}_${output}`, path: `ComfyModelStudio/${runId}`, show_preview: true, download_civitai_data: false, positive: normalizedPrompts.prompt, negative: normalizedPrompts.negative, seed_value: String(seed), width: p.width, height: p.height, modelname: cp.filename, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler_name: p.scheduler });
    else if (node.class_type === 'SaveImage') node.inputs.filename_prefix = `${prefix}_${output}`;
  }
  const pruned = prunePrompt(prompt, outputs);
  const issues = validatePrompt(pruned, info);
  return { normalizedPrompts, prompt: pruned, bindings, outputs, issues, warnings: [...converted.warnings, '正负提示词使用配方中的最终文本，替换编码节点的文本连接。', ...(bindings.memoryProfile === 'balanced' ? ['省显存：SAM 在 CPU 执行；细化尺寸上限 768，分块 VAE。'] : []), ...(bindings.mode === 'core' ? ['仅主采样：保留主采样上游，跳过下游细化和放大。'] : [])], resolvedBindings: resolved, modelFiles: [cp, ...loras].map(m => ({ id: m.id, name: m.name, path: m.path, filename: m.filename, sha256: m.sha256 || '', size: m.size, modified: m.modified })), sourceHash: workflowHash(workflow) };
}

export function validatePrompt(prompt, info) {
  const issues = [];
  for (const [id, node] of Object.entries(prompt)) {
    const definition = info[node.class_type];
    if (!definition) { issues.push({ nodeId: id, type: node.class_type, message: `缺少节点：${node.class_type}` }); continue; }
    const required = definition.input?.required || {};
    for (const [name, spec] of Object.entries({ ...required, ...(definition.input?.optional || {}) })) {
      const value = node.inputs?.[name];
      if (value === undefined) { if (name in required) issues.push({ nodeId: id, input: name, message: `节点 ${id} (${node.class_type}) 缺少必填输入 ${name}` }); continue; }
      if (!isLink(value) && Array.isArray(spec[0]) && !spec[0].includes(value)) issues.push({ nodeId: id, input: name, message: `节点 ${id} 的 ${name} 不可用：${String(value).slice(0, 120)}` });
      if (!isLink(value) && ['INT', 'FLOAT'].includes(spec[0])) { const numeric = Number(value); const options = spec[1] || {}; if (!Number.isFinite(numeric) || (spec[0] === 'INT' && !Number.isInteger(numeric)) || (options.min != null && numeric < options.min) || (options.max != null && Number.isSafeInteger(options.max) && numeric > options.max)) issues.push({ nodeId: id, input: name, message: `节点 ${id} 的 ${name} 超出允许范围` }); }
    }
    for (const [name, value] of Object.entries(node.inputs || {})) if (isLink(value) && !prompt[value[0]]) issues.push({ nodeId: id, input: name, message: `节点 ${id} 连接的上游 ${value[0]} 不存在` });
  }
  return issues;
}

export async function readWorkflow(file) {
  if (!path.isAbsolute(file) || !file.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 工作流文件');
  const stat = await fs.stat(file); if (stat.size > 20 * 1024 * 1024) throw new Error('工作流文件超过 20 MB');
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
