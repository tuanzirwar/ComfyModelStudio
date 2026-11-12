import { hasBase } from './base-models.mjs';
export const isCharacterModel = model => (model?.loraCategories || []).some(tag => /^(?:角色|人物|character)$/i.test(String(tag).trim()));
export function isCharacterEntry(entry, models, slot) {
  return (slot?.loras || []).some(row=>row.modelId===entry.modelId) || entry.role==='character' || (entry.role!=='general' && ((slot?.managed || []).some(row=>row.modelId===entry.modelId) || isCharacterModel(models.find(model=>model.id===entry.modelId))));
}
export function recipeLoraGroups(recipe, models, slot) {
  const characters=(recipe.loras || []).filter(entry=>isCharacterEntry(entry,models,slot));
  return {characters,general:(recipe.loras || []).filter(entry=>!characters.includes(entry))};
}
export function characterTokens(input) {
  const text = String(input || ''), parts = []; let start = 0, depth = 0, angle = 0, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!escaped) {
      if (char === '<') angle++; else if (char === '>') angle = Math.max(0,angle-1);
      else if (!angle && '(['.includes(char)) depth++;
      else if (!angle && ')]'.includes(char)) depth = Math.max(0,depth-1);
      else if (!angle && !depth && /[,，\n]/.test(char)) { parts.push(text.slice(start,i).trim()); start=i+1; }
    }
    escaped = char === '\\' && !escaped;
  }
  parts.push(text.slice(start).trim()); return parts.filter(Boolean);
}
const tokenKey = text => String(text).normalize('NFKC').trim().toLowerCase().replaceAll('_',' ').replace(/^\((.*?)(?::[+-]?(?:\d+(?:\.\d*)?|\.\d+))?\)$/,'$1').replace(/^\[(.*)\]$/,'$1').replace(/\\([()[\],])/g,'$1').replace(/\s+/g,' ');
const modelWords = model => (Array.isArray(model?.triggerWords) ? model.triggerWords : [model?.triggerWords]).filter(value=>typeof value==='string').flatMap(characterTokens);
export function normalizeCharacterSlot(input) {
  if (input == null) return undefined;
  if (typeof input !== 'object' || !Array.isArray(input.loras || []) || (input.loras || []).length > 32 || !Array.isArray(input.managed || []) || (input.managed || []).length > 512) throw new Error('全局角色配置无效');
  const seen = new Set();
  const loras = (input.loras || []).map(entry => {
    if (typeof entry.modelId !== 'string' || !entry.modelId || seen.has(entry.modelId)) throw new Error('全局角色 LoRA 不能重复或为空');
    seen.add(entry.modelId);
    if (![entry.strengthModel,entry.strengthClip].every(value=>Number.isFinite(Number(value))&&Math.abs(Number(value))<=20)) throw new Error('角色 LoRA 权重应在 -20 到 20 之间');
    return {...(typeof entry.prompt==='string'?{prompt:checkedBlock(entry.prompt)}:{}),modelId:entry.modelId,strengthModel:Number(entry.strengthModel),strengthClip:Number(entry.strengthClip)};
  });
  const prompt = String(input.prompt || ''); if (prompt.length > 100000) throw new Error('角色提示词过长');
  const managed = (input.managed || []).map(entry=>{
    if (typeof entry?.modelId!=='string' || !Array.isArray(entry.triggerWords) || entry.triggerWords.length>2000 || entry.triggerWords.some(word=>typeof word!=='string'||word.length>2000)) throw new Error('角色触发词快照无效');
    return {modelId:entry.modelId,triggerWords:[...entry.triggerWords]};
  });
  return {...(input.promptDefinitions!==undefined?{promptDefinitions:checkedBlock(input.promptDefinitions)}:{}),...(input.promptMode==='blocks-v1'?{promptMode:'blocks-v1'}:{}),enabled:input.enabled===true,loras,prompt,managed};
}
export function isSlotCharacter(model, slot) {
  return isCharacterModel(model) || (slot?.loras || []).some(entry=>entry.modelId===model?.id) || (slot?.managed || []).some(entry=>entry.modelId===model?.id);
}
export function updateCharacterSlot(plan, patch, models, recipes = []) {
  const slot = {...(plan.characterSlot || {enabled:false,loras:[],prompt:'',managed:[]}),...patch};
  const ids = new Set([...(slot.managed || []).map(entry=>entry.modelId),...(slot.loras || []).map(entry=>entry.modelId)]);
  for (const item of plan.items || []) {
    const recipe=recipes.find(row=>row.id===item.recipeId);
    for (const entry of item.overrides?.loras || recipe?.loras || []) if (isCharacterEntry(entry,models)) ids.add(entry.modelId);
  }
  const history = new Map((slot.managed || []).map(entry=>[entry.modelId,entry.triggerWords]));
  slot.managed = [...ids].map(modelId=>({modelId,triggerWords:[...new Set([...(history.get(modelId)||[]),...modelWords(models.find(model=>model.id===modelId))])]}));
  return {...plan,characterSlot:normalizeCharacterSlot(slot)};
}
function removeWords(text, deleting) {
  return characterTokens(text).map(token=>{
    if (deleting.has(tokenKey(token))) return '';
    const opening=token[0], closing=token.at(-1);
    if ((opening==='('&&closing===')') || (opening==='['&&closing===']')) {
      const body=token.slice(1,-1), weight=opening==='('?body.match(/:[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/)?.[0]||'':'';
      const original=weight?body.slice(0,-weight.length):body;
      const cleaned=removeWords(original,deleting);
      if (!cleaned) return '';
      if (cleaned!==original) return `${opening}${cleaned}${weight}${closing}`;
    }
    return token;
  }).filter(Boolean).join(', ');
}
// The node-only view remains editable without ever baking the global overlay
// into task overrides. Original recipes and raw per-node values are retained.
export function characterNodeBase(recipe, slot, models) {
  if(recipe.promptMode==='blocks-v1') return {...recipe,loras:(recipe.loras||[]).filter(entry=>!slot?.enabled||!isCharacterEntry(entry,models,slot)),characterDefinitions:slot?.enabled?'':recipe.characterDefinitions,characterPrompt:slot?.enabled?'':recipe.characterPrompt};
  if (!slot?.enabled) return {...recipe,loras:[...(recipe.loras || [])]};
  const removed=(recipe.loras || []).filter(entry=>isCharacterEntry(entry,models,slot));
  const loras=(recipe.loras || []).filter(entry=>!removed.includes(entry));
  const retained = new Set(loras.flatMap(entry=>modelWords(models.find(model=>model.id===entry.modelId))).map(tokenKey));
  const removing = new Set([...removed.flatMap(entry=>modelWords(models.find(model=>model.id===entry.modelId))),...(slot.managed || []).flatMap(row=>row.triggerWords || [])].map(tokenKey).filter(key=>!retained.has(key)));
  return {...recipe,loras,prompt:removing.size?removeWords(recipe.prompt,removing):String(recipe.prompt || '')};
}
function keepWords(text, keys) {
  return characterTokens(text).map(token=>{
    if (keys.has(tokenKey(token))) return token;
    const opening=token[0],closing=token.at(-1);
    if ((opening==='('&&closing===')')||(opening==='['&&closing===']')) {
      const body=token.slice(1,-1),weight=opening==='('?body.match(/:[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/)?.[0]||'':'';
      const kept=keepWords(weight?body.slice(0,-weight.length):body,keys);
      if (kept) return `${opening}${kept}${weight}${closing}`;
    }
    return '';
  }).filter(Boolean).join(', ');
}
export function recipeCharacterPrompt(recipe, models) {
  const roles=recipeLoraGroups(recipe,models).characters;
  if(recipe.promptMode==='blocks-v1') return [...roles.map(row=>row.prompt||''),recipe.characterPrompt||''].filter(Boolean).join(', ');
  const keys=new Set(roles.flatMap(entry=>modelWords(models.find(model=>model.id===entry.modelId))).map(tokenKey));
  return keepWords(recipe.prompt,keys);
}
export function mergeCharacterNodeEdit(raw, patch, slot, models) {
  if (!slot?.enabled) return patch;
  const role=entry=>isCharacterEntry(entry,models,slot);
  const next={...patch};
  if(raw.promptMode==='blocks-v1') {
    next.promptMode='blocks-v1';
    if(Array.isArray(patch.loras)) {
      let position=0;const local=patch.loras.filter(entry=>!role(entry));
      next.loras=(raw.loras||[]).flatMap(entry=>role(entry)?[{...entry}]:position<local.length?[local[position++]]:[]);
      next.loras.push(...local.slice(position));
    }
    return next;
  }
  if (Array.isArray(patch.loras)) {
    let position=0;const local=patch.loras.filter(entry=>!role(entry));
    next.loras=(raw.loras || []).flatMap(entry=>role(entry)?[{...entry}]:position<local.length?[local[position++]]:[]);
    next.loras.push(...local.slice(position));
  }
  if (typeof patch.prompt==='string') {
    const base=characterNodeBase(raw,slot,models),retained=new Set(base.loras.flatMap(entry=>modelWords(models.find(model=>model.id===entry.modelId))).map(tokenKey));
    const keys=new Set([...(raw.loras || []).filter(role).flatMap(entry=>modelWords(models.find(model=>model.id===entry.modelId))),...(slot.managed || []).flatMap(row=>row.triggerWords || [])].map(tokenKey).filter(key=>!retained.has(key)));
    const restore=keepWords(raw.prompt,keys),present=new Set(characterTokens(patch.prompt).map(tokenKey));
    const extra=characterTokens(restore).filter(word=>!present.has(tokenKey(word)));
    next.prompt=`${patch.prompt}${extra.length?`${patch.prompt.trim()?', ':''}${extra.join(', ')}`:''}`;
  }
  return next;
}
export function applyCharacterSlot(recipe, slot, models) {
  if(slot?.enabled && (slot.promptMode==='blocks-v1'||slot.promptDefinitions) && recipe.promptMode!=='blocks-v1') recipe=splitRecipePrompt(recipe,models);
  const base = characterNodeBase(recipe,slot,models); if (!slot?.enabled) return base;
  if(recipe.promptMode==='blocks-v1') {
    const global=slot.promptMode==='blocks-v1'?slot:splitRecipePrompt(slot,models);
    return {...base,characterDefinitions:global.promptDefinitions||'',characterPrompt:global.prompt,loras:[...base.loras,...global.loras.map(entry=>({...entry,role:'character'}))]};
  }
  const present=new Set(characterTokens(base.prompt).map(tokenKey)), insert=[];
  for (const word of characterTokens(slot.prompt)) if (!present.has(tokenKey(word))) { present.add(tokenKey(word)); insert.push(word); }
  const prompt=insert.length?`${base.prompt.trim()}${base.prompt.trim()?', ':''}${insert.join(', ')}`:base.prompt;
  return {...base,prompt,loras:[...base.loras,...slot.loras.map(entry=>({...entry,role:'character'}))]};
}
export function characterSlotIssues(recipe, slot, models) {
  if (!slot?.enabled) return [];
  const checkpoint=models.find(model=>model.id===recipe.checkpointId), issues=[];
  for (const entry of slot.loras || []) {
    const model=models.find(row=>row.id===entry.modelId);
    if (!model || model.missing || !['LORA','LoCon','DoRA'].includes(model.type)) issues.push('全局角色 LoRA 已缺失或不可用');
    else if (checkpoint?.baseModel && model.baseModel && !['Other','未知基模'].includes(model.baseModel) && !['Other','未知基模'].includes(checkpoint.baseModel) && !hasBase(model,checkpoint.baseModel)) issues.push(`角色“${model.name}”不匹配 ${checkpoint.name}（${checkpoint.baseModel}）`);
  }
  return [...new Set(issues)];
}

// Persist ownership, never reconstruct it by deleting text during hot swapping.
export function splitRecipePrompt(recipe, models) {
  if (recipe.promptMode === 'blocks-v1') return {...recipe,loras:(recipe.loras||[]).map(row=>({...row,prompt:String(row.prompt??'')}))};
  let common=String(recipe.prompt||'');
  const owners=new Map();
  for(const entry of recipe.loras||[]) for(const key of new Set(modelWords(models.find(row=>row.id===entry.modelId)).map(tokenKey))) owners.set(key,(owners.get(key)||0)+1);
  const loras=(recipe.loras||[]).map(entry=>{
    const keys=new Set(modelWords(models.find(row=>row.id===entry.modelId)).map(tokenKey).filter(key=>owners.get(key)===1));
    const prompt=typeof entry.prompt==='string'?entry.prompt:keepWords(common,keys);
    common=removeWords(common,keys);
    return {...entry,prompt};
  });
  return {...recipe,promptMode:'blocks-v1',prompt:common,loras};
}
export function positivePromptBlocks(recipe) {
  if(recipe.promptMode!=='blocks-v1') return [String(recipe.prompt||'')];
  return [String(recipe.prompt||''),...(recipe.loras||[]).map(row=>String(row.prompt||'')),String(recipe.characterPrompt||'')];
}
export function composeRecipePrompt(recipe) {return positivePromptBlocks(recipe).map(text=>text.trim()).filter(Boolean).join(', ');}
export function initializeLoraPrompts(entries, models) {
  return entries.map(entry=>({...entry,prompt:typeof entry.prompt==='string'?entry.prompt:modelWords(models.find(row=>row.id===entry.modelId)).join(', ')}));
}

export function checkedBlock(value) {if(typeof value!=='string'||value.length>100000)throw new Error('LoRA 提示词无效或过长');return value;}

// A legacy task may still own a full prompt even after its source recipe was edited.
export function taskRecipe(recipe, overrides={}) {
  return {...recipe,...overrides,promptMode:overrides.prompt!==undefined?overrides.promptMode:recipe?.promptMode};
}

export function effectiveRecipePrompt(recipe) {return recipe?.effectivePrompt??composeRecipePrompt(recipe||{});}
