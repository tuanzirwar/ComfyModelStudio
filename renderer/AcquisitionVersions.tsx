import { useState } from 'react';
import { Download, Package } from 'lucide-react';
import { Select } from './Select';
import { baseFamily } from '../desktop/base-models.mjs';
import { latestPerBase } from '../desktop/version-catalog.mjs';
type Any = Record<string, any>;
export function AcquisitionVersions({ preview, run, busy, onChange, categories, done }: any) {
  const [base, setBase] = useState('all'), [errors, setErrors] = useState('');
  const versions: Any[] = preview.versions || [], latest = latestPerBase(versions);
  const label = (v: Any) => v.baseTargets?.join(' / ') || v.baseModel;
  const families = (v: Any) => [...new Set((v.baseTargets?.length ? v.baseTargets : [v.baseModel]).map(baseFamily))];
  const bases = [...new Set(versions.flatMap(families))] as string[];
  const choices = versions.filter(v => base === 'all' || families(v).includes(base));
  const loading = busy.includes('version-preview') || busy.includes('bundle-download');
  const choose = async (id: string) => { const result = await run('version-preview', () => window.studio.call('acquisition:preview', { origin: preview.origin, versionId: Number(id) })); if (result) onChange(result); };
  const selected = versions.find(v => v.id === preview.versionId);
  return <div className="full acquisition-versions"><div className="parameter-grid"><label className="field"><span>基模家族</span><Select aria-label="下载基模版本筛选" value={base} disabled={loading} onChange={event => { setBase(event.target.value); const first = versions.find(v => v.downloadable && (event.target.value === 'all' || families(v).includes(event.target.value))); if (first && first.id !== preview.versionId) void choose(String(first.id)); }}><option value="all">全部基模</option>{bases.map(value => <option key={value} value={value}>{value}</option>)}</Select></label><label className="field"><span>发行版本 / 分支</span><Select aria-label="发行版本 / 分支" value={preview.versionId} disabled={loading} onChange={event => void choose(event.target.value)}>{choices.map(v => <option key={v.id} value={v.id} disabled={!v.downloadable}>{v.name} · {label(v)}{!v.downloadable ? ' · 无公开文件' : ''}</option>)}</Select></label></div>
    {selected?.recommendedStrength && <p className="field-help">作者推荐权重：{selected.recommendedStrength.min === selected.recommendedStrength.max ? selected.recommendedStrength.value : `${selected.recommendedStrength.min}–${selected.recommendedStrength.max}`}；默认 {selected.recommendedStrength.value}</p>}
    {latest.length > 1 && <div className="version-bundle"><h4><Package size={15}/>各基模最新版本包</h4><p>{latest.length} 个文件 · 约 {(latest.reduce((n, v) => n + v.sizeKB, 0) / 1024).toFixed(0)} MB · 已有相同文件会复用</p><ul>{latest.map(v => <li key={v.id}>{label(v)} · {v.name}</li>)}</ul><button type="button" className="button full" disabled={loading} onClick={async () => { setErrors(''); const result = await run('bundle-download', () => window.studio.call('download:bundle', { origin: preview.origin, modelId: preview.modelId, loraCategories: categories })); if (result) { const failed = result.results.filter((r: Any) => !r.ok); if (failed.length) setErrors(failed.map((r: Any) => `版本 ${r.versionId}：${r.error}`).join('；')); else done(); } }}><Download size={15}/>{loading ? '正在准备…' : '打包下载各基模最新版本'}</button>{errors && <p className="inline-error">{errors}</p>}</div>}
  </div>;
}
