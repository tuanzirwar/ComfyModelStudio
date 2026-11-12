import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {validateRecipe,saveRecipe} from './recipes.mjs';import {atomicJson} from './utils.mjs';
const KIND='comfy-model-studio/recipe',MAX_BYTES=5*1024*1024,MAX_LORAS=64;
const types=new Set(['LORA','LoCon','DoRA']);
const text=(v,max=262144)=>{if(typeof v!=='string'||v.length>max)throw Error('配方文字内容无效或过长');return v;};
const label=v=>text(String(v??''),500).replace(/[\x00-\x1f]/g,' ').trim();
const filename=v=>label(v).replaceAll('\\','/').split('/').at(-1)||'';
const positiveId=v=>/^\d{1,16}$/.test(String(v))&&Number(v)>0?String(v):'';
const digest=v=>typeof v==='string'&&/^[a-f\d]{64}$/i.test(v)?v.toUpperCase():'';
function reference(model){
 if(!model||model.missing)throw Error('配方引用的模型不可用，无法分享');
 const ref={name:label(model.name),filename:filename(model.filename||model.path),type:model.type,baseModel:label(model.baseModel||''),sha256:digest(model.sha256),modelId:positiveId(model.modelId),versionId:positiveId(model.versionId),fileId:positiveId(model.fileId)};
 let origin=model.origin;try{origin=origin||new URL(model.sourceUrl).origin;}catch{}
 ref.origin=['https://civitai.com','https://civitai.red'].includes(origin)?origin:'';
 if(ref.origin&&ref.modelId)ref.sourceUrl=`${ref.origin}/models/${ref.modelId}${ref.versionId?'?modelVersionId='+ref.versionId:''}`;else ref.sourceUrl='';
 return ref;
}
function normalizeReference(value,checkpoint){
 if(!value||typeof value!=='object'||(checkpoint?value.type!=='Checkpoint':!types.has(value.type)))throw Error('配方的模型类型无效');
 const ref=reference({...value,filename:filename(value.filename),path:''});
 if(!ref.name&&!ref.filename&&!ref.sha256)throw Error('缺少模型识别信息');return ref;
}
function recipeFields(input){
 return {name:text(input.name,120),prompt:text(input.prompt||''),negative:text(input.negative||''),...(input.promptMode==='blocks-v1'?{promptMode:'blocks-v1',characterPrompt:text(input.characterPrompt||'')}:{}),promptDefinitions:text(input.promptDefinitions||''),characterDefinitions:text(input.characterDefinitions||''),parameters:Object.fromEntries(['width','height','steps','cfg','seed','seedPolicy','sampler','scheduler','denoise'].filter(k=>input.parameters?.[k]!==undefined).map(k=>[k,input.parameters[k]]))};
}
export function parseRecipePackage(input){
 if(!input||input.kind!==KIND||input.schemaVersion!==1)throw Error('不是支持的配方分享文件，请选择模序导出的 .recipe.json 文件');
 if(Buffer.byteLength(JSON.stringify(input),'utf8')>MAX_BYTES)throw Error('配方文件超过 5 MB');
 if(!input.recipe||!Array.isArray(input.loras)||input.loras.length>MAX_LORAS)throw Error('配方结构无效或 LoRA 过多');
 const checkpoint=normalizeReference(input.checkpoint,true),loras=input.loras.map((entry,index)=>({key:'lora-'+(index+1),model:normalizeReference(entry.model,false),strengthModel:entry.strengthModel,strengthClip:entry.strengthClip,...(entry.role?{role:entry.role}:{}),...(input.recipe.promptMode==='blocks-v1'?{prompt:text(entry.prompt||'')}:{})}));
 const recipe=recipeFields(input.recipe),fake=[{id:'checkpoint',type:'Checkpoint'},...loras.map(entry=>({id:entry.key,type:entry.model.type}))];
 const valid=validateRecipe({...recipe,checkpointId:'checkpoint',loras:loras.map(entry=>({...entry,modelId:entry.key}))},fake);
 const result={kind:KIND,schemaVersion:1,recipe:recipeFields(valid),checkpoint,loras:loras.map((entry,index)=>({...entry,strengthModel:valid.loras[index].strengthModel,strengthClip:valid.loras[index].strengthClip})),workflow:{mode:input.workflow?.mode==='core'?'core':'full'}};
 const content=JSON.stringify(result);
 if(/(?:^|[\s"'])[A-Za-z]:[\\/]|\/(?:Users|home)\/[^/\s]+\/|(?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*["']?[A-Za-z0-9_.-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/i.test(content))throw Error('配方文本中包含本机路径或疑似密钥，请先移除后再分享或加载');
 return result;
}
export function createRecipePackage(recipe,models){
 const valid=validateRecipe(recipe,models);
 return parseRecipePackage({kind:KIND,schemaVersion:1,recipe:recipeFields(valid),checkpoint:reference(models.find(m=>m.id===valid.checkpointId)),loras:valid.loras.map(entry=>({...entry,model:reference(models.find(m=>m.id===entry.modelId))})),workflow:{mode:recipe.workflowBindings?.mode==='core'?'core':'full'}});
}
export function packageSlots(pkg){return [{key:'checkpoint',reference:pkg.checkpoint},...pkg.loras.map(entry=>({key:entry.key,reference:entry.model}))];}
function typeMatches(ref,model){return !model.missing&&(ref.type==='Checkpoint'?model.type==='Checkpoint':types.has(model.type));}
export function modelMatch(ref,models){
 const available=models.filter(m=>typeMatches(ref,m)),hash=ref.sha256;
 const exactHash=hash?available.filter(m=>digest(m.sha256)===hash):[];
 if(exactHash.length)return {kind:'hash',modelId:exactHash[0].id,reason:'SHA256 一致',candidates:exactHash.map(m=>m.id)};
 const conflict=m=>hash&&digest(m.sha256)&&digest(m.sha256)!==hash;
 const exactFile=ref.origin&&ref.versionId&&ref.fileId?available.filter(m=>!conflict(m)&&m.origin===ref.origin&&positiveId(m.versionId)===ref.versionId&&positiveId(m.fileId)===ref.fileId):[];
 if(exactFile.length===1)return {kind:'version',modelId:exactFile[0].id,reason:'同一发行文件（未校验内容哈希）',candidates:[exactFile[0].id]};
 const candidates=available.filter(m=>!conflict(m)&&ref.filename&&filename(m.filename||m.path).toLowerCase()===ref.filename.toLowerCase());
 return {kind:candidates.length===1?'suggested':candidates.length?'ambiguous':'missing',modelId:'',suggestedId:candidates.length===1?candidates[0].id:'',reason:candidates.length===1?'仅文件名相同，请选择确认':candidates.length?'存在多个同名文件，请选择':'本机尚未找到匹配模型',candidates:candidates.map(m=>m.id)};
}
export function previewRecipePackage(input,models){const pkg=parseRecipePackage(input);return {package:pkg,slots:packageSlots(pkg).map(slot=>({...slot,...modelMatch(slot.reference,models)}))};}
function sameContent(ref,model){return !!ref.sha256&&digest(model.sha256)===ref.sha256||!!ref.origin&&!!ref.versionId&&!!ref.fileId&&model.origin===ref.origin&&positiveId(model.versionId)===ref.versionId&&positiveId(model.fileId)===ref.fileId&&(!ref.sha256||!digest(model.sha256)||ref.sha256===digest(model.sha256));}
export function importRecipePackage(store,input,{name,matches={},confirmChanges=false}={}){
 const pkg=parseRecipePackage(input),models=store.models(),selected={},skipped=[];let changed=false;
 for(const slot of packageSlots(pkg)){
  const value=matches[slot.key];if(value==='__skip__'&&slot.key!=='checkpoint'){skipped.push(slot.key);changed=true;continue;}
  const model=models.find(m=>m.id===value&&typeMatches(slot.reference,m));if(!model)throw Error('请为基模及每个 LoRA 选择本机模型，或明确跳过缺失的 LoRA');
  selected[slot.key]=model;if(!sameContent(slot.reference,model))changed=true;
 }
 if(changed&&!confirmChanges)throw Error('请确认仅名称匹配、替换模型或跳过 LoRA 会影响复现效果');
 const names=new Set(store.get('recipes',[]).map(recipe=>recipe.name));let wanted=label(name||pkg.recipe.name),candidate=wanted,n=2;while(names.has(candidate))candidate=`${wanted} (${n++})`;
 const loras=pkg.loras.filter(entry=>!skipped.includes(entry.key)).map(({model,key,...entry})=>({...entry,modelId:selected[key].id}));
 return saveRecipe(store,{...pkg.recipe,name:candidate,checkpointId:selected.checkpoint.id,loras,coverId:'',notes:'',workflowPath:'',workflowBindings:{mode:pkg.workflow.mode,memoryProfile:'balanced'}});
}
export class RecipeSharing{
 constructor(store,{openFile,saveFile,clock=()=>Date.now()}={}){this.store=store;this.openFile=openFile;this.saveFile=saveFile;this.clock=clock;this.sessions=new Map();}
 add(kind,bundle){for(const [key,row]of this.sessions)if(row.expires<this.clock())this.sessions.delete(key);while(this.sessions.size>=8)this.sessions.delete(this.sessions.keys().next().value);const token=randomUUID();this.sessions.set(token,{kind,bundle,expires:this.clock()+30*60*1000});return token;}
 session(token,kind){const row=this.sessions.get(token);if(!row||row.kind!==kind||row.expires<this.clock())throw Error('配方预览已失效，请重新打开');return row;}
 preview(id){const recipe=this.store.get('recipes',[]).find(r=>r.id===id);if(!recipe)throw Error('配方不存在');const bundle=createRecipePackage(recipe,this.store.models());return {token:this.add('export',bundle),package:bundle};}
 async export(token){const {bundle}=this.session(token,'export');const filename=bundle.recipe.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)+'.recipe.json',file=await this.saveFile(filename);if(!file)return null;await atomicJson(file,bundle);return {saved:true};}
 async open(){const file=await this.openFile();if(!file)return null;const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw Error('请选择 5 MB 以内的配方 JSON 文件');let input;try{input=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('无法读取配方 JSON，请检查文件内容');}const preview=previewRecipePackage(input,this.store.models());return {...preview,token:this.add('import',preview.package)};}
 load({token,...options}){const {bundle}=this.session(token,'import');const recipe=importRecipePackage(this.store,bundle,options);this.sessions.delete(token);return recipe;}
}
