export function recipeFrequencies(recipes: { loras?: { modelId: string }[] }[]): Record<string, number> {
 const counts: Record<string, number> = {};
 for (const recipe of recipes) for (const id of new Set((recipe.loras || []).map(lora => lora.modelId))) counts[id] = (counts[id] || 0) + 1;
 return counts;
}
