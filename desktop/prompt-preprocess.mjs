import {positivePromptBlocks} from './character-slot.mjs';
export function parsePromptDefinitions(input='') {
 if(typeof input!=='string'||input.length>100000)throw new Error('提示词语法定义无效或过长');
 const definitions=new Map();
 for(const [index,line] of input.replace(/\r\n?/g,'\n').split('\n').entries()) {
  // Whitespace-delimited inline comments leave URL values such as https:// intact.
  const text=line.replace(/(^|\s)\/\/.*$/,'').trim();if(!text||text.startsWith('#'))continue;
  const separator=text.indexOf('=');
  const key=text.slice(0,separator).trim(),value=text.slice(separator+1).trim();
  if(separator<1||!key||/\s/.test(key)||key.length>128||!value)throw new Error(`语法定义第 ${index+1} 行无效，请使用 占位符 = 替换内容`);
  if(definitions.has(key))throw new Error(`语法定义第 ${index+1} 行重复定义了 ${key}`);
  if(definitions.size>=256)throw new Error('最多支持 256 个提示词占位符');
  definitions.set(key,value);
 }
 return definitions;
}
export function preprocessRecipePrompts(recipe) {
 const definitions=new Map([...parsePromptDefinitions(recipe.promptDefinitions||''),...parsePromptDefinitions(recipe.characterDefinitions||'')]);
 // Literal, simultaneous, longest key first. Values never become new code or rules.
 const keys=[...definitions.keys()].sort((a,b)=>b.length-a.length);
 const pattern=keys.length?new RegExp(keys.map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'):null;
 const replace=text=>pattern?String(text||'').replace(pattern,key=>definitions.get(key)):String(text||'');
 const blocks=positivePromptBlocks(recipe).map(replace);
 return {prompt:blocks.filter(text=>text.trim()).join(', '),negative:replace(recipe.negative),blocks,definitions:[...definitions].map(([key,value])=>({key,value}))};
}
