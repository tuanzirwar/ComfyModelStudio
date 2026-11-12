import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { normalizeBaseModels } from '../desktop/base-models.mjs';
import './base-model-editor.css';

export function BaseModelEditor({ value, suggestions = [], detected = [], onChange }: { value: string[]; suggestions?: string[]; detected?: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState(''), [error, setError] = useState('');
  const add = (input: string) => { try { const next = normalizeBaseModels([...value, ...normalizeBaseModels(input)]); onChange(next); setDraft(''); setError(''); } catch (e: any) { setError(e.message); } };
  const available = [...new Set(suggestions)].filter(label => label !== '未知基模' && !value.some(v => v.toLowerCase() === label.toLowerCase()));
  return <section className="base-model-editor" aria-label="基础模型 · 可多选"><span>基础模型 · 可多选</span><div className="base-model-chips">{value.map((label, index) => <button key={label} type="button" title={`移除 ${label}`} onClick={() => onChange(value.filter(item => item !== label))}>{label}{index === 0 && <small>主基模</small>}<X size={12}/></button>)}{!value.length && <small>尚未指定基模</small>}</div>
    <div className="base-model-add"><input aria-label="添加兼容基模" placeholder="输入基模名称，回车添加；多个用逗号分隔" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(draft); } }} onBlur={() => { if (draft.trim()) add(draft); }}/><button type="button" className="button" disabled={!draft.trim()} onClick={() => add(draft)}><Plus size={14}/>添加</button></div>
    {!!available.length && <div className="base-model-suggestions">{available.map(label => <button type="button" key={label} onClick={() => add(label)}>＋ {label}</button>)}</div>}
    {!!detected.length && <p>作者资料标注：{detected.join('、')}（随模型发行版本保存）</p>}<p>可添加多个兼容基模，模型会显示在对应分类中。第一项为主基模。</p>{error && <p role="alert">{error}</p>}
  </section>;
}
