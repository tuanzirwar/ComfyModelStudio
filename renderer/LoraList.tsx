import {promptOwnerColor} from './prompt-owner';
import { loraDefault } from './lora-defaults';
import { modelBases, baseLabel } from '../desktop/base-models.mjs';
import { Select } from './Select';
import { SecondaryCategoryFilter } from './SecondaryCategoryFilter';
import { syncLoraPrompt } from './lora-prompt';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { ArrowDown, ArrowUp, BookOpen, Check, Copy, ExternalLink, GripVertical, Image as ImageIcon, Layers3, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react';
import { appendTriggerWords, loraOptions, sameBase, initialLoraBase, validLoraBase, loraMatchKind, sourceSummary, triggerWords } from './lora-utils';
import type { LoraModel } from './lora-utils';
import { PageDetails } from './PageDetails';
import './loras.css';

type Any = Record<string, any>;
type Props = { independentPrompts?: boolean; onMove?: (modelId: string) => void; moveLabel?: string; addLabel?: string; browseLabel?: string; initialCategory?: string; loras: Any[]; models: LoraModel[]; onChange: (list: Any[], prompt?: string) => void; checkpointBase?: string; prompt?: string; onPromptChange?: (text: string) => void; run?: (key: string, action: () => Promise<any>) => Promise<any> };
const api = (method: string, payload?: any) => window.studio.call(method, payload);
function move(list: Any[], from: number, to: number) { if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list; const next = [...list], [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }

function LoraCover({ model, className = '' }: any) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [model?.coverPath, model?.coverRevision, model?.modified]);
  const src = model?.coverPath ? `cms-media://asset/${encodeURIComponent(model.id)}/cover?v=${model.coverRevision || model.modified || 0}` : '';
  return <div className={`lora-image ${className}`}>{src && !failed ? <img src={src} alt={model.name || model.filename} loading="lazy" onError={() => setFailed(true)}/> : <div className="lora-image-placeholder"><Layers3 size={25}/><span>暂无封面</span></div>}</div>;
}

export function LoraList({ loras, models, onChange: commit, checkpointBase, prompt, onPromptChange, run, initialCategory, addLabel, browseLabel, onMove, moveLabel, independentPrompts }: Props) {
  const drag = useRef(-1), [picker, setPicker] = useState<{ id?: string } | null>(null);
  const onChange = (next: Any[]) => commit(next, independentPrompts ? prompt : syncLoraPrompt(prompt || '', loras.map(e => ({ modelId: e.modelId })), next.map(e => ({ modelId: e.modelId })), models));
  const closePicker = useCallback(() => setPicker(null), []);
  const [feedback, setFeedback] = useState('');
  const copy = async (words: unknown) => { try { await navigator.clipboard.writeText(triggerWords(words).join(', ')); setFeedback('触发词已复制'); } catch { setFeedback('无法复制，请打开资料后手动选择'); } };
  return <>
    <div className="lora-list">{loras.map((lora, index) => {
      const model = models.find(candidate => candidate.id === lora.modelId), words = triggerWords(model?.triggerWords);
      return <div className={`lora-row lora-rich-row ${independentPrompts?`owner-${promptOwnerColor(lora.modelId)} owned-lora-row`:""}`} key={`${lora.modelId}:${index}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onChange(move(loras, drag.current, index)); drag.current = -1; }}>
        <span className="drag-handle" draggable title="拖动调整 LoRA 顺序" onDragStart={event => { drag.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }} onDragEnd={() => { drag.current = -1; }}><GripVertical size={15}/></span>
        <button className="lora-row-thumbnail" aria-label={`查看 ${model?.name || 'LoRA'} 资料`} disabled={!model} onClick={() => setPicker({ id: lora.modelId })}><LoraCover model={model}/></button>
        <div className="lora-row-content"><button className="lora-row-title" onClick={() => setPicker({ id: lora.modelId })} disabled={!model}>{model?.name || '缺失的 LoRA'}</button><span className="lora-row-base">{baseLabel(model)}{model?.missing ? ' · 文件缺失' : ''}</span>
          <div className="lora-row-triggers">{words.length ? <button title="复制全部触发词" onClick={() => copy(words)}><Copy size={10}/><span>{words.join(', ')}</span></button> : <span>未记录触发词</span>}</div>
          <div className="lora-weights">{[['strengthModel', '模型'], ['strengthClip', 'CLIP']].map(([key, label]) => <label key={key}>{label}<input aria-label={`${model?.name || 'LoRA'} ${label}权重`} type="number" step="0.05" min="-20" max="20" value={lora[key]} onChange={event => onChange(loras.map((entry, i) => i === index ? { ...entry, [key]: Number(event.target.value) } : entry))}/></label>)}</div>
          <span className="field-help">{model?.recommendedStrength ? `作者推荐 ${model.recommendedStrength.min}–${model.recommendedStrength.max} · 默认 ${model.recommendedStrength.value}` : ''}</span><button className="lora-inline-info" disabled={!model} onClick={() => setPicker({ id: lora.modelId })}><BookOpen size={11}/>说明与详情</button>{onMove && <button type="button" className="lora-inline-info" aria-label={`${moveLabel} ${model?.name || 'LoRA'}`} onClick={() => onMove(lora.modelId)}><ArrowUp size={11}/>{moveLabel}</button>}
        </div>
        <div className="lora-row-actions"><button className="icon-button" aria-label="上移 LoRA" disabled={index === 0} onClick={() => onChange(move(loras, index, index - 1))}><ArrowUp size={15}/></button><button className="icon-button" aria-label="下移 LoRA" disabled={index === loras.length - 1} onClick={() => onChange(move(loras, index, index + 1))}><ArrowDown size={15}/></button><button className="icon-button" aria-label="移除 LoRA" onClick={() => onChange(loras.filter((_, i) => i !== index))}><X size={15}/></button></div>
      </div>;
    })}</div>
    <button className="add-lora lora-browse-button" onClick={() => setPicker({})}><Plus size={16}/><span>{browseLabel || '浏览并添加 LoRA'}</span><ImageIcon size={14}/></button>
    {feedback && <p className="lora-list-feedback" role="status">{feedback}</p>}
    {picker && <LoraPicker {...{ loras, models, onChange, checkpointBase, prompt, onPromptChange, run, initialCategory, addLabel, independentPrompts }} initialId={picker.id} close={closePicker}/>}
  </>;
}

function LoraPicker({ loras, models, onChange, checkpointBase, prompt, onPromptChange, run, initialCategory, addLabel, initialId, close, independentPrompts }: Props & { initialId?: string; close: () => void }) {
  const initialBase = initialLoraBase(models, checkpointBase, initialId);
  const [category, setCategory] = useState(initialId ? 'all' : initialCategory || 'all');
  const [query, setQuery] = useState(''), [base, setBase] = useState(initialBase), [activeId, setActiveId] = useState(initialId || ''), [tab, setTab] = useState('model'), [limit, setLimit] = useState(60);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null), [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const all = useMemo(() => loraOptions(models), [models]);


  const bases = [...new Set(all.flatMap(model => modelBases(model)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const effectiveBase = validLoraBase(base, bases, checkpointBase);
  const options = useMemo(() => loraOptions(models, { query, base: effectiveBase, checkpointBase, category }), [models, query, effectiveBase, checkpointBase, category]);
  const active = options.find(model => model.id === activeId) || (initialId === activeId ? models.find(model => model.id === initialId && model.missing) : null) || options[0];
  useEffect(() => { if (base !== effectiveBase) setBase(effectiveBase); }, [base, effectiveBase]);
  const words = triggerWords(active?.triggerWords), added = Boolean(active && loras.some(lora => lora.modelId === active.id));
  const sources = sourceSummary(active || {});
  const rawReadme = active ? tab === 'version' ? active.versionDescription || '' : active.description || '' : '';
  const readme = useMemo(() => DOMPurify.sanitize(rawReadme, { FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'input', 'style'], FORBID_ATTR: ['style', 'srcset'] }), [rawReadme]);
  useEffect(() => { setLimit(60); }, [query, base, category]);
  useEffect(() => { setTab('model'); setFeedback(null); }, [active?.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; searchRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('.studio-select-menu')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation(); searchRef.current?.focus(); }
      if (event.key === 'Tab') {
        const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]') || [])].filter(element => element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [close]);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setFeedback({ text: '触发词已复制' }); } catch { setFeedback({ text: '无法复制，请手动选择触发词', error: true }); } };
  const insertWords = () => { if (!active) return; if (!added) onChange([...loras, loraDefault(active)]); else if(independentPrompts) onChange(loras.map(entry=>entry.modelId===active.id?{...entry,prompt:appendTriggerWords(entry.prompt||'',active.triggerWords)}:entry)); else onPromptChange?.(syncLoraPrompt(prompt || '', [], [{ modelId: active.id }], models)); setFeedback({ text: 'LoRA 与触发词已同步' }); };
  const enrich = async () => {
    if (!active || loading) return;
    setLoading(true);
    try { const result = run ? await run(`lora-enrich-${active.id}`, () => api('model:enrich', { id: active.id })) : await api('model:enrich', { id: active.id }); if (result) setFeedback({ text: result.coverError ? `“${active.name}”资料已补全；封面：${result.coverError}` : `“${active.name}”网站资料与封面已更新`, error: Boolean(result.coverError) }); else setFeedback({ text: '资料获取未完成，请检查网络和密钥设置。', error: true }); }
    catch (error) { setFeedback({ text: String((error as Error).message), error: true }); }
    finally { setLoading(false); }
  };
  return createPortal(<div className="lora-picker-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section ref={dialogRef} className="lora-picker" role="dialog" aria-modal="true" aria-label="LoRA 图文选择器">
    <header className="lora-picker-header"><div><span>BUILD YOUR MODEL COMBINATION</span><h2>挑选 LoRA</h2><p>先看封面与说明，再加入当前组合。</p></div><button className="icon-button" aria-label="关闭 LoRA 选择器" onClick={close}><X size={20}/></button></header>
    <div className="lora-picker-body"><aside className="lora-picker-library">
      <div className="lora-picker-search"><Search size={16}/><input ref={searchRef} aria-label="搜索 LoRA" placeholder="名称、版本、文件名或触发词…" value={query} onChange={event => { setQuery(event.target.value); setActiveId(''); }}/>{query && <button className="icon-button" aria-label="清空 LoRA 搜索" onClick={() => { setQuery(''); setActiveId(''); }}><X size={13}/></button>}</div>
      <div className="lora-picker-filters"><Select aria-label="LoRA 基模筛选" value={effectiveBase} onChange={event => { setBase(event.target.value); setActiveId(''); }}><option value="all">全部基模</option>{validLoraBase('compatible', bases, checkpointBase) === 'compatible' && <option value="compatible">匹配当前 Checkpoint</option>}{bases.map(value => <option key={value} value={value}>{value}{sameBase(value, checkpointBase) ? ' · 当前 Checkpoint' : ''}</option>)}</Select><span>{options.length} 个可用</span></div>
      <div className="lora-category-filter"><SecondaryCategoryFilter categories={all.flatMap(model => model.loraCategories || [])} value={category} onChange={value => { setCategory(value); setActiveId(''); }}/></div><div className="lora-picker-scroll">{options.length ? <><div className="lora-choice-grid">{options.slice(0, limit).map(model => {
        const inUse = loras.some(lora => lora.modelId === model.id);
        return <button key={model.id} className={`lora-choice ${active?.id === model.id ? 'active' : ''}`} aria-pressed={active?.id === model.id} onClick={() => { setActiveId(model.id); setFeedback(null); }}><LoraCover model={model}/><div className="lora-choice-text"><strong title={model.name}>{model.name || model.filename}</strong><span>{model.versionName || model.filename}</span><div><span>{baseLabel(model)}</span>{inUse && <b><Check size={10}/>已加入</b>}</div><p>{triggerWords(model.triggerWords).join(', ') || '未记录触发词'}</p></div></button>;
      })}</div>{options.length > limit && <button className="button lora-load-more" onClick={() => setLimit(current => current + 60)}>加载更多 · 剩余 {options.length - limit} 个</button>}</> : <div className="lora-picker-empty"><Search size={27}/><strong>{all.length ? '没有匹配的 LoRA' : '还没有可用 LoRA'}</strong><p>{all.length ? '试试其他基模、名称或触发词。' : '先在模型库扫描已有文件，或粘贴模型链接下载。'}</p>{all.length > 0 && <button className="button" onClick={() => { setBase('all'); setCategory('all'); setQuery(''); setActiveId(''); }}>显示全部 LoRA</button>}</div>}</div>
    </aside>
    <section className="lora-picker-preview">{active ? <>
      <div className="lora-preview-scroll"><LoraCover model={active} className="lora-preview-cover"/><div className="lora-preview-content">
        <div className="lora-preview-badges"><span>{active.type === 'LORA' ? 'LoRA' : active.type}</span><span>{baseLabel(active)}</span>{loraMatchKind(active, checkpointBase) !== 'none' && <span className={loraMatchKind(active, checkpointBase) === 'version' ? 'matching' : loraMatchKind(active, checkpointBase) === 'version-mismatch' ? 'version-mismatch' : 'base-compatible'}>{loraMatchKind(active, checkpointBase) === 'version' ? '训练版本一致' : loraMatchKind(active, checkpointBase) === 'version-mismatch' ? '训练基模版本不同' : '同架构 · 非专属匹配'}</span>}</div>
        <h3>{active.name || active.filename}</h3><div className="lora-category-chips">{active.loraCategories?.length ? active.loraCategories.map((label: string) => <span key={label}>{label}</span>) : <span>二级分类：未分类</span>}</div><p className="lora-preview-version">{active.versionName || active.filename}{active.creator && ` · ${active.creator}`}</p>
        {checkpointBase && checkpointBase !== '未知基模' && active.baseModel && active.baseModel !== '未知基模' && !sameBase(modelBases(active), checkpointBase) && <p className="lora-base-notice">当前 Checkpoint 为 {checkpointBase}，此 LoRA 为 {baseLabel(active)}，请确认搭配是否兼容。</p>}
        <div className="lora-trigger-heading"><strong>Trigger Words</strong><button disabled={!words.length} onClick={() => copy(words.join(', '))}><Copy size={12}/>复制全部</button></div>
        <div className="lora-trigger-words">{words.length ? words.map(word => <button key={word} title="点击复制触发词" onClick={() => copy(word)}>{word}<Copy size={11}/></button>) : <span>此模型尚未记录触发词</span>}</div>
        {onPromptChange && words.length > 0 && <button className="button lora-insert-words" onClick={insertWords}><Plus size={13}/>{independentPrompts?'恢复此 LoRA 的默认触发词':'将触发词写入正向提示词'}</button>}
        <div className="lora-preview-tabs" role="group" aria-label="LoRA 资料页签">{[['model', '模型 README'], ['version', '版本说明'], ['details', '详情与来源']].map(([value, label]) => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
        {tab === 'details' ? <div className="lora-extra-details"><dl>{[['基础模型', baseLabel(active)], ['文件名', active.filename], ['作者', active.creator || '未记录'], ['版本 ID', active.versionId || '未关联'], ['SHA256', active.sha256 || '未记录']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><PageDetails details={active.pageDetails} model={active}/></div> : readme ? <div className="readme lora-readme" onClick={event => { const link = (event.target as HTMLElement).closest('a'); if (link) { event.preventDefault(); void api('external:open', { url: link.href }); } }} dangerouslySetInnerHTML={{ __html: readme }}/> : <div className="lora-readme-empty"><BookOpen size={22}/><strong>{tab === 'version' && sources.api ? '本地未记录额外版本说明' : sources.api ? '本地未记录模型说明' : '尚未保存模型说明'}</strong><p>{sources.api ? '可查看另一个说明页签，或打开来源页面。' : '可点击下方“补全网站资料”，在工具内取得 README 和触发词。'}</p></div>}
        <div className="lora-preview-links"><button disabled={loading || active.missing} onClick={enrich}>{loading ? <Loader2 className="spin" size={13}/> : <RefreshCw size={13}/>}补全网站资料</button>{active.sourceUrl && <button onClick={() => api('external:open', { url: active.sourceUrl })}><ExternalLink size={13}/>来源页面</button>}</div>
      </div></div>
      <div className="lora-add-footer"><div><strong>{added ? '此 LoRA 已在组合中' : active.missing ? '模型文件缺失' : `默认模型 / CLIP 权重：${loraDefault(active).strengthModel} / ${loraDefault(active).strengthClip}`}</strong><span>加入时自动写入触发词；移除时自动清理，共用词保留。</span></div><button className="button primary" disabled={added || active.missing} onClick={() => { if (!loras.some(lora => lora.modelId === active.id)) { onChange([...loras, loraDefault(active)]); setFeedback({ text: `已加入：${active.name}` }); } }}>{added ? <Check size={15}/> : <Plus size={15}/>}<span>{added ? '已加入' : addLabel || '加入当前配方'}</span></button></div>
    </> : <div className="lora-picker-empty"><ImageIcon size={35}/><strong>选择一张卡片查看资料</strong><p>封面、触发词与 README 会显示在这里。</p></div>}</section></div>
    <footer className="lora-picker-footer"><div role="status" className={feedback?.error ? 'error-text' : ''}>{feedback?.text || `当前组合 ${loras.length} 个 LoRA · 资料从本地模型库读取`}</div><button className="button" onClick={close}><Check size={14}/>完成选择</button></footer>
  </section></div>, document.body);
}
