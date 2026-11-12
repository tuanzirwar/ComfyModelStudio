import { recipeCoverId } from './recipe-covers.mjs';
import { composeRecipePrompt, checkedBlock, normalizeCharacterSlot } from './character-slot.mjs';
import path from 'node:path';
import { id } from './utils.mjs';
export function validateRecipe(input, models) {
  if (!String(input.name || '').trim()) throw new Error('请填写配方名称');
  if (!composeRecipePrompt(input).trim()) throw new Error('每个配方都需要正向提示词');
  const checkpoint = models.find(model => model.id === input.checkpointId && model.type === 'Checkpoint' && !model.missing);
  if (!checkpoint) throw new Error('请选择可用的 Checkpoint');
  const loras = (input.loras || []).map(item => {
    if (!models.some(model => model.id === item.modelId && ['LORA', 'LoCon', 'DoRA'].includes(model.type) && !model.missing)) throw new Error('配方中有不存在或不可用的 LoRA');
    if (![item.strengthModel, item.strengthClip].every(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 20)) throw new Error('LoRA 权重应在 -20 到 20 之间');
    if (item.role !== undefined && !['character','general'].includes(item.role)) throw new Error('LoRA 分区无效');
    return { ...(input.promptDefinitions!==undefined?{promptDefinitions:checkedBlock(input.promptDefinitions)}:{}), ...(input.characterDefinitions!==undefined?{characterDefinitions:checkedBlock(input.characterDefinitions)}:{}), ...(input.promptMode==='blocks-v1'?{prompt:checkedBlock(item.prompt??'')}:{}), ...(item.role ? {role:item.role} : {}), modelId: item.modelId, strengthModel: Number(item.strengthModel), strengthClip: Number(item.strengthClip) };
  });
  const params = input.parameters || {};
  for (const key of ['width', 'height']) if (!Number.isInteger(Number(params[key])) || Number(params[key]) < 64 || Number(params[key]) > 16384) throw new Error('图片宽高应为 64 到 16384 的整数');
  if (!Number.isInteger(Number(params.steps)) || Number(params.steps) < 1 || Number(params.steps) > 1000) throw new Error('采样步数应为 1 到 1000');
  if (!Number.isFinite(Number(params.cfg)) || Number(params.cfg) < 0 || Number(params.cfg) > 100) throw new Error('CFG 应为 0 到 100');
  if (params.denoise != null && (!Number.isFinite(Number(params.denoise)) || Number(params.denoise) < 0 || Number(params.denoise) > 1)) throw new Error('降噪应为 0 到 1');
  const seed = String(params.seed ?? '0');
  if (!/^\d{1,20}$/.test(seed) || BigInt(seed) > 18446744073709551615n) throw new Error('种子应为有效的 64 位无符号整数');
  return { ...(input.promptDefinitions!==undefined?{promptDefinitions:checkedBlock(input.promptDefinitions)}:{}), ...(input.characterDefinitions!==undefined?{characterDefinitions:checkedBlock(input.characterDefinitions)}:{}), ...(input.promptMode==='blocks-v1'?{promptMode:'blocks-v1',characterPrompt:checkedBlock(input.characterPrompt??'')}:{}), coverId: recipeCoverId(input.coverId), coverRevision: Number.isFinite(Number(input.coverRevision)) ? Number(input.coverRevision) : 0, id: input.id || id(), name: input.name.trim(), checkpointId: checkpoint.id, loras, prompt: String(input.prompt||'').trim(), negative: String(input.negative || ''), notes: String(input.notes || ''), parameters: { width: Number(params.width), height: Number(params.height), steps: Number(params.steps), cfg: Number(params.cfg), seed, seedPolicy: ['fixed', 'increment', 'random'].includes(params.seedPolicy) ? params.seedPolicy : 'fixed', sampler: String(params.sampler || 'euler'), scheduler: String(params.scheduler || 'normal'), denoise: params.denoise == null ? 1 : Number(params.denoise) }, workflowPath: String(input.workflowPath || ''), workflowBindings: structuredClone(input.workflowBindings || {}), updatedAt: new Date().toISOString() };
}
export function saveRecipe(store, input) {
  const recipe = validateRecipe(input, store.models()); const all = store.get('recipes', []); const old = all.find(r => r.id === recipe.id);
  recipe.revision = (old?.revision || 0) + 1;
  const revisions = store.get('recipeRevisions', []); revisions.push(recipe); store.set('recipeRevisions', revisions);
  store.set('recipes', [recipe, ...all.filter(r => r.id !== recipe.id)]); return recipe;
}
export function duplicateRecipe(store, recipeId) {
  const source=store.get('recipes',[]).find(recipe=>recipe.id===recipeId);
  if(!source)throw new Error('配方不存在，无法复制');
  const names=new Set(store.get('recipes',[]).map(recipe=>recipe.name));let name=`${source.name} 副本`,number=2;
  while(names.has(name))name=`${source.name} 副本 ${number++}`;
  const copy=structuredClone(source);copy.id=id();copy.name=name;delete copy.revision;delete copy.updatedAt;
  return saveRecipe(store,copy);
}
export function validatePlan(input, recipes) {
  const characterSlot = normalizeCharacterSlot(input.characterSlot);
  const items = (input.items || []).map(item => {
    const recipe = recipes.find(r => r.id === item.recipeId); if (!recipe) throw new Error('编排中存在已删除的配方，请先移除该任务');
    const candidateCount = item.candidateCount ?? (item.groups == null && item.imagesPerGroup == null ? 10 : undefined);
    if (candidateCount !== undefined && (!Number.isInteger(Number(candidateCount)) || Number(candidateCount) < 1 || Number(candidateCount) > 1000)) throw new Error('每个配方的备选图数量应为 1 到 1000');
    const groups = candidateCount === undefined ? Number(item.groups) : 1;
    const imagesPerGroup = candidateCount === undefined ? Number(item.imagesPerGroup) : Number(candidateCount);
    if (!Number.isInteger(groups) || groups < 1 || groups > 1000) throw new Error('每项生成组数应为 1 到 1000');
    if (!Number.isInteger(imagesPerGroup) || imagesPerGroup < 1 || imagesPerGroup > (candidateCount === undefined ? 100 : 1000)) throw new Error('每组图片数应为 1 到 100');
    const overrides = item.overrides || {};
    if (overrides.parameters?.seed !== undefined && (!/^\d{1,20}$/.test(String(overrides.parameters.seed)) || BigInt(overrides.parameters.seed) > 18446744073709551615n)) throw new Error('任务种子无效');
    return { id: item.id || id(), recipeId: recipe.id, recipeRevision: recipe.revision, recipeSnapshot: recipe, enabled: item.enabled !== false, candidateCount: candidateCount === undefined ? undefined : Number(candidateCount), groups, imagesPerGroup, overrides: { promptDefinitions:overrides.promptDefinitions??recipe.promptDefinitions,characterDefinitions:overrides.characterDefinitions??recipe.characterDefinitions,promptMode:undefined,...((overrides.prompt!==undefined?overrides.promptMode:recipe.promptMode)==='blocks-v1'?{promptMode:'blocks-v1',characterPrompt:overrides.characterPrompt??recipe.characterPrompt??''}:{}), prompt: String(overrides.prompt ?? recipe.prompt), negative: String(overrides.negative ?? recipe.negative), checkpointId: overrides.checkpointId || recipe.checkpointId, loras: Array.isArray(overrides.loras) ? overrides.loras : recipe.loras, parameters: overrides.parameters || recipe.parameters, workflowPath: overrides.workflowPath ?? recipe.workflowPath, workflowBindings: overrides.workflowBindings ?? recipe.workflowBindings } };
  });
  if (items.some(i => !composeRecipePrompt(i.overrides).trim()) && !(characterSlot?.enabled && composeRecipePrompt(characterSlot).trim())) throw new Error('任务正向提示词不能为空');
  if (items.length > 500) throw new Error('单个编排最多 500 项');
  const outputDirectory = String(input.outputDirectory || '').trim();
  if (outputDirectory && !path.isAbsolute(outputDirectory)) throw new Error('配方流输出目录需要绝对路径');
  return { characterSlot, savedPlanId: input.savedPlanId || '', quickPreview: input.quickPreview === true, ...(typeof input.nameSpecified==='boolean'?{nameSpecified:input.nameSpecified}:{}), name: String(input.name ?? ''), randomizeSeeds: input.randomizeSeeds !== false, outputDirectory, items, updatedAt: new Date().toISOString(), executionEnabled: true };
}
