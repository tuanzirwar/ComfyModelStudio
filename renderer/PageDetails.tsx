import { sourceSummary } from './lora-utils';
type DetailSnapshot = { status?: string; capturedAt?: string; entries?: { label: string; value: string }[]; message?: string };
export function PageDetails({ details, model = {} }: { details?: DetailSnapshot; model?: Record<string, any> }) {
  const source = sourceSummary({ ...model, pageDetails: details });
  return <section className="page-details source-information" aria-label="模型资料来源">
    <div className="page-details-heading"><h3>资料来源</h3><span className={source.api ? 'captured' : ''}>{source.apiArchived ? '网站接口资料已保存' : source.api ? '已关联网站版本' : '本地模型资料'}</span></div>
    <p>{source.api ? '类型、基模、触发词和作者说明可通过网站接口保存，单独使用工具即可。可在模型详情及说明页签查看。' : '本地模型可直接用于配方。按哈希补全网站资料后，可查看作者说明与触发词。'}</p>
    {source.captured&&<details className="page-snapshot-extra"><summary>历史网页资料</summary><p>保存于 {details?.capturedAt?new Date(details.capturedAt).toLocaleString('zh-CN'):'—'}</p>{details?.entries&&<dl>{details.entries.map((entry,index)=><div key={`${entry.label}-${index}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}</details>}
  </section>;
}
