import {promptPreview} from './prompt-preview';
import {useState} from 'react';import {Layers3,UserRound} from 'lucide-react';
import {LoraList} from './LoraList';
import {composeRecipePrompt,characterTokens,isCharacterModel,recipeLoraGroups,recipeCharacterPrompt,initializeLoraPrompts} from '../desktop/character-slot.mjs';
import {mergeLoraGroup} from './recipe-lora-groups';
import './recipe-loras.css';
type Any=Record<string,any>;
function Avatar({model}:any){const[failed,setFailed]=useState(false);return <span className="node-role-avatar">{model?.coverPath&&!failed?<img src={`cms-media://asset/${encodeURIComponent(model.id)}/cover?v=${model.coverRevision||model.modified||0}`} alt="" onError={()=>setFailed(true)}/>:<UserRound size={16}/>}</span>;}
export function NodeCharacters({recipe,models,slot,compact=false}:any){
 const roles=slot?.enabled?slot.loras:recipeLoraGroups(recipe,models).characters;
 const words=characterTokens(promptPreview({...recipe,characterDefinitions:slot?.enabled?slot.promptDefinitions:recipe.characterDefinitions,promptMode:undefined,prompt:slot?.enabled?composeRecipePrompt(slot):recipeCharacterPrompt(recipe,models)}));
 return <section className={`node-characters ${compact?'compact':''}`} aria-label="当前生效角色"><header><UserRound size={13}/><strong>角色</strong><span>{slot?.enabled?(roles.length?'全局替换':'全局清空'):'节点配置'}</span></header>{roles.length?<div className="node-role-list">{roles.map((entry:Any)=>{const model=models.find((row:Any)=>row.id===entry.modelId);return <div className="node-role" key={entry.modelId}><Avatar model={model}/><div><strong>{model?.name||'缺失的角色 LoRA'}</strong><small>模型 {entry.strengthModel} · CLIP {entry.strengthClip}</small></div></div>;})}</div>:<p className="node-role-empty">无角色 LoRA</p>}{words.length>0&&<p className="node-role-words" title={words.join(', ')}><span>角色提示词</span>{words.join(', ')}</p>}</section>;
}
export function RecipeLoras({loras,models,prompt,onChange,onPromptChange,checkpointBase,run,inherited}:any){
 const groups=recipeLoraGroups({loras},models);
 const roleIds=new Set(groups.characters.map(entry=>entry.modelId)),generalIds=new Set(groups.general.map(entry=>entry.modelId));
 const commit=(kind:'character'|'general',next:Any[])=>onChange(initializeLoraPrompts(mergeLoraGroup(loras,next,kind,models),models),prompt);
 const move=(modelId:string,kind:string)=>onChange(loras.map((entry:Any)=>entry.modelId===modelId?{...entry,role:kind}:entry),prompt);
 const roles=models.filter((model:Any)=>!generalIds.has(model.id)),materials=models.filter((model:Any)=>!roleIds.has(model.id)&&(!isCharacterModel(model)||generalIds.has(model.id)));
 const category=models.flatMap((model:Any)=>model.loraCategories||[]).find((tag:string)=>/^(角色|人物|character)$/i.test(tag));
 return <div className="recipe-lora-groups"><section className="recipe-lora-group character-group" aria-label="角色 LoRA 分区"><header><UserRound size={15}/><h4>角色 LoRA</h4><span>{inherited?'跟随全局替换':`${groups.characters.length} 个角色`}</span></header>{inherited?<><div className="character-inherited"><NodeCharacters recipe={{loras:inherited.loras}} slot={{...inherited,enabled:true}} models={models}/></div><p className="lora-group-help">当前角色由编排上方的全局角色区统一管理。</p></>:<><LoraList independentPrompts models={roles} loras={groups.characters} prompt={prompt} onChange={next=>commit('character',next)} onPromptChange={onPromptChange} checkpointBase={checkpointBase} run={run} initialCategory={category?`tag:${category}`:'all'} addLabel="加入角色区" browseLabel="添加角色 LoRA" onMove={id=>move(id,'general')} moveLabel="移到素材区"/><p className="lora-group-help">专属提示词在右侧独立编辑，移除 LoRA 时整块退出；可手动调整分区。</p></>}</section><section className="recipe-lora-group material-group" aria-label="素材 LoRA 分区"><header><Layers3 size={15}/><h4>素材 LoRA</h4><span>画风 · 姿势 · 其他</span></header><LoraList independentPrompts models={materials} loras={groups.general} prompt={prompt} onChange={next=>commit('general',next)} onPromptChange={onPromptChange} checkpointBase={checkpointBase} run={run} browseLabel="添加素材 LoRA" addLabel="加入素材区" onMove={inherited?undefined:id=>move(id,'character')} moveLabel="移到角色区"/></section></div>;
}
