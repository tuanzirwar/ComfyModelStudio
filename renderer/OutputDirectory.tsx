import { useEffect, useState } from 'react';
import { FolderOpen, Save } from 'lucide-react';
const api = (method: string, payload?: any) => window.studio.call(method, payload);

export function DirectoryField({ value, onChange, label = '自动化输出目录', placeholder = '', compact = false }: any) {
  return <label className={`field output-directory-field ${compact ? 'compact' : ''}`}><span>{label}</span><div><input aria-label={label} value={value || ''} placeholder={placeholder} onChange={event => onChange(event.target.value)}/><button type="button" className="button" aria-label={`选择${label}`} onClick={async () => { const directory = await api('choose-directory', { path: value || placeholder, title: `选择${label}` }); if (directory) onChange(directory); }}><FolderOpen size={15}/><span>选择目录</span></button></div></label>;
}
export function OutputDirectorySetting({ value, run, busy, notify }: any) {
  const [directory, setDirectory] = useState(value || '');
  useEffect(() => setDirectory(value || ''), [value]);
  return <section className="output-default-directory"><div><DirectoryField compact value={directory} onChange={setDirectory} label="新批次默认输出目录"/><p>目录修改用于之后的新批次。可在编排中为单个配方流指定目录。</p></div><button className="button" disabled={!directory.trim() || directory === value || busy.includes('output-directory')} onClick={async () => { const result = await run('output-directory', () => api('output:directory', { path: directory })); if (result) notify('自动化输出目录已保存'); }}><Save size={14}/>保存目录</button></section>;
}
export function CandidateQuantity({ item, onChange }: any) {
  const count = item.candidateCount ?? Number(item.groups || 1) * Number(item.imagesPerGroup || 1);
  const update = (value: number) => onChange({ candidateCount: value, groups: 1, imagesPerGroup: value });
  return <section className="candidate-quantity"><label className="field"><span>本配方备选图数量</span><input aria-label="本配方备选图数量" type="number" min="1" max="1000" value={count} onChange={event => update(Number(event.target.value))}/></label><div className="candidate-presets">{[5, 10, 20].map(value => <button key={value} className={count === value ? 'selected' : ''} onClick={() => update(value)}>{value} 张</button>)}</div><p>先生成备选，再到自动化输出挑选保留。</p></section>;
}
