import {PromptFind} from './PromptFind';
import type {FindMatch} from './PromptFind';
import { useEffect, useId, useRef, useState } from 'react';
import { PromptPaint } from './PromptPaint';
import { PromptSelectionTranslation } from './PromptSelectionTranslation';
import { PromptTranslation } from './PromptTranslation';
import { PromptSuggestions } from './PromptSuggestions';
import { completionToken, replaceCompletion, completePromptWeight } from './prompt-completion';
import type { CompletionToken } from './prompt-completion';
export { insertPromptTag } from './prompt-completion';
import './prompt-editor.css';
import './prompt-colors.css';

type Props = { searchable?:boolean; positive?: boolean; onSelectionChange?: (value:{start:number;end:number;text:string}|null)=>void; value: string; onChange: (value: string) => void; rows?: number; className?: string; placeholder?: string; label: string };
export function PromptEditor({ value, onChange, rows, className, placeholder, label, positive, onSelectionChange, searchable }: Props) {
  const [findOpen,setFindOpen]=useState(false),[findSeed,setFindSeed]=useState(''),[findFocus,setFindFocus]=useState(0),[findMatch,setFindMatch]=useState<FindMatch|null>(null);
  const finding=useRef(false);finding.current=findOpen;const lastQuery=useRef('');
  const heightKey=`cms-prompt-height:${label}`;
  const [editorHeight,setEditorHeight]=useState<number|null>(()=>{try{const stored=localStorage.getItem(heightKey),height=Number(stored);return stored&&Number.isFinite(height)?Math.min(1000,Math.max(80,height)):null;}catch{return null;}});
  const resize=useRef<{pointer:number;start:number;height:number;next:number}|null>(null);
  const rememberHeight=(height:number|null)=>{try{if(height===null)localStorage.removeItem(heightKey);else localStorage.setItem(heightKey,String(Math.round(height)));}catch{}};
  const resetHeight=()=>{setEditorHeight(null);rememberHeight(null);};
  const selectionCallback=useRef(onSelectionChange);selectionCallback.current=onSelectionChange;
  const textarea = useRef<HTMLTextAreaElement>(null), [token, setToken] = useState<CompletionToken | null>(null);
  const [results, setResults] = useState<any[]>([]), [active, setActive] = useState(-1), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [selection, setSelection] = useState('');
  useEffect(() => { setSelection(''); }, [value]);
  const [hasMore, setHasMore] = useState(false);
  const currentToken = useRef(token); currentToken.current = token;
  const composing = useRef(false), listId = useId();
  const [focused,setFocused]=useState(false);
  const close = () => { setToken(null); setResults([]); };
  useEffect(() => {
    const field = textarea.current; if (!field) return;
    const update = () => { if(finding.current)return;selectionCallback.current?.(field.selectionEnd>field.selectionStart?{start:field.selectionStart,end:field.selectionEnd,text:field.value.slice(field.selectionStart,field.selectionEnd)}:null); const raw = field.value.slice(field.selectionStart, field.selectionEnd).trim(); const selected = /[a-zA-Z\u3400-\u9fff]/.test(raw) ? raw : ''; setSelection(selected); if (selected) close(); };
    const focus=()=>setFocused(true),blur=()=>{setFocused(false);close();},otherFocus=(event:FocusEvent)=>{if(event.target!==field)blur();};
    field.addEventListener('select', update);field.addEventListener('focus',focus);field.addEventListener('blur',blur);document.addEventListener('focusin',otherFocus);
    setFocused(document.activeElement===field);
    return () => {field.removeEventListener('select', update);field.removeEventListener('focus',focus);field.removeEventListener('blur',blur);document.removeEventListener('focusin',otherFocus);};
  }, []);
  useEffect(() => {
    if (!token) return;
    let canceled = false; setLoading(true); setError(''); setResults([]); setActive(-1);
    const timer = setTimeout(() => { void window.studio.call('prompt:search', { query: token.query }).then(result => { if (!canceled) { setResults(result.results); setHasMore(Boolean(result.hasMore)); } }).catch(err => { if (!canceled) setError(err.message); }).finally(() => { if (!canceled) setLoading(false); }); }, 180);
    return () => { canceled = true; clearTimeout(timer); };
  }, [token]);
  useEffect(() => { if (token && (token.source !== value||document.activeElement!==textarea.current)) close(); }, [value]);
  const more = async () => {
    const requested = token; if (!requested || loading) return; setLoading(true);
    try { const response = await window.studio.call('prompt:search', { query: requested.query, offset: results.length }); if (currentToken.current === requested) { setResults(previous => [...previous, ...response.results]); setHasMore(Boolean(response.hasMore)); } }
    catch (error: any) { if (currentToken.current === requested) setError(error.message); }
    finally { if (currentToken.current === requested) setLoading(false); }
  };
  const choose = (tag: string) => {
    const field = textarea.current; if (!field || !token ||field.selectionStart!==field.selectionEnd) return;
    const next = replaceCompletion(field.value, token, tag); close(); if (!next) return;
    onChange(next.text); requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.caret, next.caret); });
  };
  const openFind=()=>{close();setSelection('');if(!findOpen){const field=textarea.current,selected=field?.value.slice(field.selectionStart,field.selectionEnd)||'';setFindSeed(selected&&!selected.includes('\n')&&selected.length<200?selected:lastQuery.current);}setFindOpen(true);setFindFocus(n=>n+1);};
  const closeFind=()=>{setFindOpen(false);setFindMatch(null);requestAnimationFrame(()=>textarea.current?.focus({preventScroll:true}));};
  const painted = positive ?? /正向|正面|positive/i.test(label);
  return <div className="prompt-editor" onKeyDownCapture={event=>{if(searchable&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();openFind();}else if(findOpen&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFind();}}}>{findOpen&&<PromptFind textarea={textarea} value={value||''} seed={findSeed} focusRequest={findFocus} onMatch={setFindMatch} onQuery={text=>{lastQuery.current=text;}} close={closeFind}/>}<div className={`prompt-text-surface ${painted ? 'painted' : ''}`}><textarea style={painted?{resize:'none',...(editorHeight===null?{}:{height:editorHeight,minHeight:80})}:undefined} spellCheck={false} ref={textarea} aria-label={label} aria-autocomplete="list" aria-controls={token ? listId : undefined} aria-activedescendant={token && results.length && active>=0 ? `${listId}-${active}` : undefined} rows={rows} className={className} placeholder={placeholder} value={value || ''}
    onChange={event => { setFocused(document.activeElement===event.currentTarget); setSelection(''); selectionCallback.current?.(null); onChange(event.target.value); if (!event.target.value.slice(0,event.target.selectionStart).endsWith('\n')&&!composing.current && !(event.nativeEvent as InputEvent).isComposing) setToken(completionToken(event.target.value, event.target.selectionStart)); }}
    onCompositionStart={() => { composing.current = true; close(); }} onCompositionEnd={event => { composing.current = false; setToken(completionToken(event.currentTarget.value, event.currentTarget.selectionStart)); }}
    onSelect={event => { const field = event.currentTarget; if(finding.current)return;selectionCallback.current?.(field.selectionEnd>field.selectionStart?{start:field.selectionStart,end:field.selectionEnd,text:field.value.slice(field.selectionStart,field.selectionEnd)}:null); const raw = field.value.slice(field.selectionStart, field.selectionEnd).trim(); const selected = /[a-zA-Z\u3400-\u9fff]/.test(raw) ? raw : ''; setSelection(selected); if (selected) close(); }}
    onMouseDown={close} onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);close();}} onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Escape') event.stopPropagation(); return; }
      if (event.key === ':' || event.key === '：') {
        const field = event.currentTarget, next = completePromptWeight(field.value, field.selectionStart, field.selectionEnd);
        if (next) { event.preventDefault(); close(); setSelection(''); onChange(next.text); requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.start,next.end); }); return; }
      }
      if (selection && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSelection(''); return; }
      if (!token) return;
      if(event.currentTarget.selectionStart!==event.currentTarget.selectionEnd||event.ctrlKey||event.metaKey||event.altKey){close();return;}
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (results.length && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(index => index<0?(event.key==='ArrowDown'?0:results.length-1):(index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length); }
      else if (results.length && (event.key==='Tab'||(event.key==='Enter'&&active>=0)) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); choose(results[Math.max(0,active)].en); }
      else if (['ArrowLeft','ArrowRight','Home','End','Enter','Tab'].includes(event.key)) close();
    }}/>{painted && <PromptPaint textarea={textarea} value={value || ''} findMatch={findMatch}/>}</div>
    {painted&&<div className="prompt-height-handle" role="separator" aria-label={`${label}高度调整`} aria-orientation="horizontal" aria-valuemin={80} aria-valuemax={1000} aria-valuenow={editorHeight??Math.round(textarea.current?.getBoundingClientRect().height||150)} tabIndex={0} title="上下拖动调整高度 · 双击恢复默认 · 方向键微调" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();close();const height=textarea.current?.getBoundingClientRect().height||150;resize.current={pointer:event.pointerId,start:event.clientY,height,next:height};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const drag=resize.current;if(!drag||drag.pointer!==event.pointerId)return;if(!event.buttons){rememberHeight(drag.next);resize.current=null;return;}drag.next=Math.min(1000,Math.max(80,drag.height+event.clientY-drag.start));setEditorHeight(drag.next);rememberHeight(drag.next);}} onPointerUp={event=>{const drag=resize.current;if(!drag||drag.pointer!==event.pointerId)return;rememberHeight(drag.next);resize.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{if(resize.current)rememberHeight(resize.current.next);resize.current=null;}} onLostPointerCapture={()=>{if(resize.current)rememberHeight(resize.current.next);resize.current=null;}} onDoubleClick={resetHeight} onKeyDown={event=>{if(event.key==='Home'){event.preventDefault();resetHeight();}else if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const height=Math.min(1000,Math.max(80,(textarea.current?.getBoundingClientRect().height||150)+(event.key==='ArrowDown'?1:-1)*(event.shiftKey?60:20)));setEditorHeight(height);rememberHeight(height);}}}><span/><small>拖动调整高度</small><span/></div>}
    <PromptTranslation textarea={textarea} value={value || ''} disabled={Boolean(findOpen || token || selection)}/><div className="prompt-editor-toolbar"><small>回车换行 · Tab/点击采用 · ↑↓选择后回车确认 · 悬停/框选翻译 · : 添加权重</small>{searchable&&<button className="prompt-find-open" type="button" aria-label={`查找${label}`} onClick={openFind}>查找 <kbd>Ctrl+F</kbd></button>}</div>
    {!findOpen && selection && <PromptSelectionTranslation text={selection} dismiss={() => setSelection('')}/>}
    {!findOpen && focused && token && <PromptSuggestions textarea={textarea} more={more} hasMore={hasMore} query={token.query} rows={results} active={active} loading={loading} error={error} choose={choose} close={close} listId={listId}/>}
  </div>;
}
