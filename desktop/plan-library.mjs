import {taskRecipe} from './character-slot.mjs';
import { id } from './utils.mjs';
export function savePlanTemplate(store, input) {
  const name = String(input.name || input.plan?.name || '').trim();
  if (!name || name.length > 100) throw new Error('编排名需要 1–100 字');
  if (!Array.isArray(input.plan?.items) || input.plan.items.length > 500 || JSON.stringify(input.plan).length > 8 * 1024 * 1024) throw new Error('编排内容无效');
  const rows = store.get('planTemplates', []), previous = rows.find(row => row.id === input.id);
  if (input.id && !previous) throw new Error('该编排已不存在，请另存为');
  const frozen = structuredClone(input.plan), recipes = store.get('recipes', []);
  frozen.items = frozen.items.map(task => {
    const recipe = recipes.find(row => row.id === task.recipeId); if (!recipe) return task;
    return { ...task, overrides: { promptDefinitions:recipe.promptDefinitions,characterDefinitions:recipe.characterDefinitions,promptMode: recipe.promptMode, characterPrompt: recipe.characterPrompt, prompt: recipe.prompt, negative: recipe.negative, checkpointId: recipe.checkpointId, loras: structuredClone(recipe.loras || []), parameters: structuredClone(recipe.parameters || {}), workflowPath: recipe.workflowPath || '', workflowBindings: structuredClone(recipe.workflowBindings || {}), ...task.overrides, promptMode:taskRecipe(recipe,task.overrides).promptMode } };
  });
  const saved = { id: previous?.id || id(), name, plan: { ...frozen, name }, updatedAt: new Date().toISOString() };
  store.set('planTemplates', [saved, ...rows.filter(row => row.id !== saved.id)]); return saved;
}
export function loadPlanTemplate(store, templateId) {
  const row = store.get('planTemplates', []).find(row => row.id === templateId);
  if (!row) throw new Error('该编排已不存在');
  return { ...structuredClone(row.plan), name: row.name, savedPlanId: row.id, updatedAt: new Date().toISOString() };
}
export function renamePlanTemplate(store, templateId, input) {
  const name = String(input || '').trim(); if (!name || name.length > 100) throw new Error('编排名需要 1–100 字');
  const rows = store.get('planTemplates', []), row = rows.find(row => row.id === templateId);
  if (!row) throw new Error('该编排已不存在');
  row.name = name; row.plan.name = name; row.plan.nameSpecified=true; row.updatedAt = new Date().toISOString(); store.set('planTemplates', rows); return row;
}
export function deletePlanTemplate(store, templateId) {
  const rows = store.get('planTemplates', []);
  if (!rows.some(row => row.id === templateId)) throw new Error('该编排已删除或不存在');
  store.set('planTemplates', rows.filter(row => row.id !== templateId));
  const current = store.get('plan');
  if (current?.savedPlanId === templateId) store.set('plan', {...current,savedPlanId:''});
  return true;
}
