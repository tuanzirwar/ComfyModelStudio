import {recipeLoraGroups} from '../desktop/character-slot.mjs';
type Any=Record<string,any>;
export function mergeLoraGroup(before:Any[],next:Any[],kind:'character'|'general',models:Any[]){
 const group=recipeLoraGroups({loras:before},models),ids=new Set((kind==='character'?group.characters:group.general).map(entry=>entry.modelId));let position=0;
 const rows=next.map(entry=>({...entry,role:kind}));const combined=before.flatMap(entry=>ids.has(entry.modelId)?position<rows.length?[rows[position++]]:[]:[entry]);
 combined.push(...rows.slice(position));return combined;
}
