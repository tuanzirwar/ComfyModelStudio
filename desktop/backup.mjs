import { applyCharacterSlot } from './character-slot.mjs';
import { savePlanTemplate } from './plan-library.mjs';
import path from 'node:path';
import { loraCategories } from './categories.mjs';
import { sourceOrigin } from './civitai.mjs';
import { validateRecipe, validatePlan } from './recipes.mjs';

export function exportBackup(store) {
  return { schemaVersion: 1, planTemplates: store.get('planTemplates', []), removedModels: store.removedModels(), loraCategories: loraCategories(store), exportedAt: new Date().toISOString(), settings: store.get('settings'), recipes: store.get('recipes', []), recipeRevisions: store.get('recipeRevisions', []), plan: store.get('plan'), models: store.models().map(({ coverPath, ...model }) => model) };
}
export function prepareBackup(store, backup) {
  if (backup?.schemaVersion !== 1 || !Array.isArray(backup.recipes) || !Array.isArray(backup.models) || backup.models.length > 100000 || backup.recipes.length > 10000) throw new Error('不是有效的模序备份');
  const current = store.models(); const ids = new Map();
  const removed = backup.removedModels || [];
  if (!Array.isArray(removed) || removed.length > 100000 || removed.some(entry => typeof entry?.model?.id !== 'string' || typeof entry.model.path !== 'string' || !path.isAbsolute(entry.model.path))) throw new Error('备份中的已移除模型记录无效');
  for (const entry of removed) ids.set(entry.model.id, current.find(model => model.path.toLowerCase() === entry.model.path.toLowerCase())?.id || entry.model.id);
  const models = backup.models.map(model => {
    if (typeof model.id !== 'string' || typeof model.path !== 'string' || !path.isAbsolute(model.path)) throw new Error('备份模型记录无效');
    const prior = current.find(m => m.path.toLowerCase() === model.path.toLowerCase()); const targetId = prior?.id || model.id; ids.set(model.id, targetId);
    return { ...model, id: targetId, coverPath: prior?.coverPath || '' };
  });
  const visiblePaths = new Set([...models, ...current].map(model => model.path.toLowerCase()));
  const removedModels = [...new Map([...store.removedModels(), ...removed].map(entry => [entry.model.path.toLowerCase(), entry])).values()].filter(entry => !visiblePaths.has(entry.model.path.toLowerCase()));
  const available = [...models, ...current.filter(m => !models.some(i => i.id === m.id)), ...removedModels.map(entry => entry.model)].map(m => ({ ...m, missing: false }));
  const remap = value => ({ ...value, checkpointId: ids.get(value.checkpointId) || value.checkpointId, loras: (value.loras || []).map(lora => ({ ...lora, modelId: ids.get(lora.modelId) || lora.modelId })) });
  const recipes = backup.recipes.map(recipe => ({ ...validateRecipe(remap(recipe), available), revision: Number(recipe.revision) || 1 }));
  const allRecipes = [...recipes, ...store.get('recipes', []).filter(r => !recipes.some(i => i.id === r.id))];
  const remapCharacter = slot => slot ? { ...slot, loras: (slot.loras || []).map(lora => ({ ...lora, modelId: ids.get(lora.modelId) || lora.modelId })), managed: (slot.managed || []).map(row => ({ ...row, modelId: ids.get(row.modelId) || row.modelId })) } : undefined;
  const rawPlan = backup.plan ? { ...backup.plan, characterSlot: remapCharacter(backup.plan.characterSlot), items: backup.plan.items.map(item => ({ ...item, overrides: remap(item.overrides || {}) })) } : null;
  const plan = rawPlan ? validatePlan(rawPlan, allRecipes) : null;
  for (const item of plan?.items || []) validateRecipe(applyCharacterSlot({ ...item.recipeSnapshot, ...item.overrides }, plan.characterSlot, available), available);
  const oldSettings = store.get('settings'); let settings = oldSettings;
  if (backup.settings) {
    const paths = { ...oldSettings.paths, ...backup.settings.paths };
    for (const [type, folder] of Object.entries(paths)) if (typeof folder !== 'string' || (folder!==''&&!path.isAbsolute(folder))) throw new Error(`备份中的 ${type} 目录无效`);
    settings = { ...oldSettings, ...([1,2,4,8].includes(backup.settings.downloadConnections) ? { downloadConnections: backup.settings.downloadConnections } : {}), ...(['aurora','obsidian','pearl'].includes(backup.settings.uiTheme) ? { uiTheme: backup.settings.uiTheme } : {}), paths, sourceOrigin: sourceOrigin(backup.settings.sourceOrigin || oldSettings.sourceOrigin) };
    if (backup.settings.automationOutputDirectory !== undefined) { if (typeof backup.settings.automationOutputDirectory !== 'string' || !path.isAbsolute(backup.settings.automationOutputDirectory)) throw new Error('备份中的自动化输出目录无效'); settings.automationOutputDirectory = backup.settings.automationOutputDirectory; }
  }
  const planTemplates = backup.planTemplates || [];
  if (!Array.isArray(planTemplates) || planTemplates.length > 10000) throw new Error('备份编排库无效');
  for (const row of planTemplates) if (typeof row.id !== 'string' || !row.name?.trim() || !Array.isArray(row.plan?.items) || row.plan.items.length > 500) throw new Error('备份编排格式无效');
  return { planTemplates: planTemplates.map(row => ({ ...row, plan: { ...row.plan, characterSlot: remapCharacter(row.plan.characterSlot), items: row.plan.items.map(item => ({ ...item, overrides: remap(item.overrides || {}) })) } })), removedModels, loraCategories: [...new Set([...loraCategories(store), ...(backup.loraCategories || [])])], models, recipes: allRecipes, plan, settings, recipeRevisions: [...store.get('recipeRevisions', []), ...(backup.recipeRevisions || []).map(remap)] };
}
export function commitBackup(store, prepared) {
  store.db.exec('BEGIN');
  try {
    for (const model of prepared.models) store.upsert(model);
    for (const key of ['settings', 'recipes', 'recipeRevisions', 'loraCategories', 'removedModels']) store.set(key, prepared[key]);
    if (prepared.plan) store.set('plan', prepared.plan);
    for (const row of prepared.planTemplates || []) { const prior = store.get('planTemplates', []).find(item => item.id === row.id); const saved = savePlanTemplate(store, { id: prior?.id, name: row.name, plan: row.plan }); if (!prior) store.set('planTemplates', store.get('planTemplates', []).map(item => item.id === saved.id ? { ...item, id: row.id } : item)); }
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
