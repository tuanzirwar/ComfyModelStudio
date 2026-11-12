import { hasBase, modelBases } from './base-models.mjs';
import { WAI } from './version-catalog.mjs';
export function missingBaseRequirements(models) {
  const checkpoints = models.filter(m => ['Checkpoint', 'UNet'].includes(m.type) && !m.missing);
  const groups = new Map();
  for (const lora of models.filter(m => ['LORA','LoCon','DoRA'].includes(m.type) && !m.missing)) {
    const targets = lora.baseTargets?.length ? lora.baseTargets : [lora.baseModel || '未知基模'];
    for (const target of targets) {
      if (checkpoints.some(cp => hasBase(cp, target))) continue;
      if (!groups.has(target)) groups.set(target, { name: target, modelNames: [], modelIds: [] });
      groups.get(target).modelNames.push(lora.name); groups.get(target).modelIds.push(lora.id);
    }
  }
  const sources = {
    'SD 1.5': [62437,66991], 'SDXL 1.0': [101055,128078], 'NoobAI': [833294,1190596],
    'NoobAI-XL Epsilon v1.1': [833294,1116447], 'NoobAI-XL V-Pred': [833294,1190596],
    'Anima v1.0': [2458426,2945208], [`${WAI} v14.0`]: [827184,1761560],
    Lumina: [2378608,2674864], 'Wan Video 14B t2v': [1329096,1707796],
  };
  return [...groups.values()].map(item => ({ ...item, count: item.modelIds.length, source: sources[item.name] ? { modelId: sources[item.name][0], versionId: sources[item.name][1], origin: 'https://civitai.red' } : null })).sort((a,b) => a.name.localeCompare(b.name));
}
