import path from 'node:path';
import { createHash } from 'node:crypto';

function truncate(value, limit) { let result = ''; for (const char of value) { if (result.length + char.length > limit) break; result += char; } return result; }
export function outputSegment(value, limit = 24, fallback = '未命名') {
  let result = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*%\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  result = truncate(result, limit).replace(/[. ]+$/g, '');
  if (!result || /^_+$/.test(result)) result = truncate(fallback, limit);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = truncate(`_${result}`, limit);
  return result;
}
export function localStamp(value) {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('批次时间无效，无法生成输出名称');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
export function automaticFlowName(plan,definitions,createdAt) {
  const specified=String(plan.name||'').trim();
  const automatic=plan.nameSpecified===false||!specified||(plan.nameSpecified!==true&&!plan.savedPlanId&&specified==='我的自动化编排');
  const seen=new Set(),nodeNames=[];for(const definition of definitions){const key=definition.taskId??definition.taskOrder??definition.recipe.id;if(!seen.has(key)){seen.add(key);nodeNames.push(String(definition.recipe.name||'未命名节点'));}}
  return {name:automatic?`${localStamp(createdAt)}_${nodeNames.join('_')}`:specified,autoNamed:automatic,nodeNames};
}
export function createOutputNaming(run, { appRoot = '', comfyRoot = '' } = {}) {
  const flowName = run.kind === 'plan' ? String(run.name || '未命名配方流') : '单配方';
  const flow = outputSegment(flowName, 24, '未命名配方流');
  const suffix = String(run.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 8) || createHash('sha256').update(String(run.id)).digest('hex').slice(0, 8);
  let folderName = `${flow}__${localStamp(run.createdAt)}_${suffix}`;
  const roots = [appRoot, comfyRoot ? path.join(comfyRoot, 'ComfyModelStudio') : ''].filter(Boolean);
  const longest = Math.max(0, ...roots.map(root => path.resolve(root).length));
  if(run.autoNamed){const budget=Math.min(120,240-longest-2-20-62);if(budget<34)throw new Error('输出目录过长，请选择更短的输出路径');const digest=createHash('sha256').update(flowName).digest('hex').slice(0,6);folderName=`${outputSegment(flowName,budget-9)}_${suffix}`;if(folderName.length>budget||flowName.length>budget-9)folderName=`${outputSegment(flowName,budget-16)}_${digest}_${suffix}`;}
  const stemLimit = Math.min(118, 240 - longest - folderName.length - 2 - 20);
  if (stemLimit < 62) throw new Error('输出目录过长，无法保留配方流、组次与种子信息，请选择更短的输出路径');
  return { version: 1, ...(run.autoNamed?{autoNamed:true,nodeNames:run.nodeNames||[]}:{}), flowName, flow, folderName, stemLimit, timeZone: 'Asia/Shanghai', format: '配方流__顺序-配方__G组-I张__S种子__O输出__A尝试' };
}
export function taskOrder(run, item) {
  if (Number.isInteger(item.taskOrder) && item.taskOrder > 0) return item.taskOrder;
  if (run.kind !== 'plan') return 1;
  if (!item.taskId) return item.order || 1;
  return [...new Set(run.items.map(candidate => candidate.taskId).filter(Boolean))].indexOf(item.taskId) + 1 || item.order || 1;
}
export function outputStem(naming, run, item, outputIndex = 0) {
  const pad = (value, width) => String(Math.max(1, Number(value) || 1)).padStart(width, '0');
  const seed = /^\d{1,20}$/.test(String(item.seed)) ? String(item.seed) : outputSegment(item.seed, 20, 'unknown');
  const order = pad(taskOrder(run, item), 2);
  const tail = `__G${pad(item.group, 3)}-I${pad(item.image, 3)}__S${seed}__O${pad(outputIndex + 1, 2)}__A${pad(item.attempt, 2)}`;
  const budget = naming.stemLimit - tail.length - order.length - 3;
  if (budget < 4) throw new Error('输出名称超出路径长度限制');
  const flowLimit = Math.min(24, Math.max(2, Math.floor(budget * .45)));
  const flow = outputSegment(naming.flowName, flowLimit, '配方流');
  const recipe = outputSegment(item.name, budget - flow.length, '配方');
  return `${flow}__${order}-${recipe}${tail}`;
}
export function outputFilename(naming, run, item, outputIndex = 0, extension = 'png') {
  extension = String(extension).replace(/^\./, '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(extension)) extension = 'png';
  return `${outputStem(naming, run, item, outputIndex)}.${extension}`;
}
export function applyOutputNaming(snapshot, run, item) {
  if (!run.outputNaming) throw new Error('批次缺少输出命名规则');
  const directory = `ComfyModelStudio/${run.outputNaming.folderName}`;
  for (const [index, nodeId] of snapshot.outputs.entries()) {
    const node = snapshot.prompt[nodeId]; if (!node) continue;
    const stem = outputStem(run.outputNaming, run, item, index);
    if (node.class_type === 'SaveImage') node.inputs.filename_prefix = `${directory}/${stem}`;
    if (node.class_type === 'Image Saver') { node.inputs.path = directory; node.inputs.filename = stem; }
  }
  snapshot.outputNaming = { ...run.outputNaming, itemName: item.name, taskOrder: taskOrder(run, item) };
  return snapshot;
}
