import { Copy, FolderOpen, SlidersHorizontal, Workflow, X } from 'lucide-react';
const api = (method: string, payload?: any) => window.studio.call(method, payload);
export function OutputProfile({ detail, close, copy }: any) {
  return <div className="drawer-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><aside className="detail-drawer output-detail-drawer" role="dialog" aria-modal="true" aria-label="输出参数与提示词">
    <header className="drawer-header"><span>输出档案 <span>OUTPUT PROFILE</span></span><button className="icon-button" aria-label="关闭输出档案" onClick={close}><X size={18}/></button></header>
    <div className="detail-scroll"><div className="output-detail-image"><img src={detail.output.src} alt={detail.item.name}/></div><div className="detail-section">
      <div className="output-detail-breadcrumb"><Workflow size={13}/>{detail.flowName}<span> / {detail.item.name}</span></div><h2>{detail.recipe?.name || detail.item.name}</h2>
      <div className="info-block"><label>备选图名称</label><code>{detail.output.filename}</code></div>
      <div className="detail-facts"><div><span>组次 / 图片</span><strong>{detail.group} / {detail.image}</strong></div><div><span>种子</span><strong>{detail.seed}</strong></div>{Object.entries({ width: '宽度', height: '高度', steps: '步数', cfg: 'CFG', sampler: '采样器', scheduler: '调度器' }).map(([key, label]) => <div key={key}><span>{label}</span><strong>{detail.recipe?.parameters?.[key] ?? '—'}</strong></div>)}</div>
      {[['正向提示词', 'prompt'], ['负向提示词', 'negative']].map(([label, key]) => <section key={key}><div className="section-heading"><h3>{label}</h3><button onClick={() => copy(detail.recipe?.[key] || '', `已复制${label}`)}><Copy size={13}/>复制</button></div><p className="output-prompt-text">{detail.recipe?.[key] || '无'}</p></section>)}
      <div className="section-heading"><h3>实际模型组合</h3></div><div className="output-model-list">{(detail.models || []).map((model: any, index: number) => { const lora = detail.recipe?.loras?.[index - 1]; return <div key={`${model.id}:${index}`}><span className="badge">{index === 0 ? 'Checkpoint' : `LoRA ${index}`}</span><strong>{model.name || model.filename}</strong>{lora && <small>模型 {lora.strengthModel} · CLIP {lora.strengthClip}</small>}</div>; })}</div>
      <div className="info-block"><label>工作流</label><code>{detail.workflowPath}</code></div><div className="info-block"><label>ComfyUI 任务 ID</label><code>{detail.promptId}</code></div>
      <div className="detail-tools"><button className="button" onClick={() => detail.albumId ? api('album:reveal', { id: detail.albumId, index: detail.output.index }) : api('run:reveal', { runId: detail.runId, itemId: detail.item.id, index: detail.output.index })}><FolderOpen size={14}/>本地图片</button>{!detail.albumId && <button className="button" onClick={() => api('run:reveal', { runId: detail.runId, itemId: detail.item.id, snapshot: true })}><SlidersHorizontal size={14}/>完整运行快照</button>}</div>
    </div></div>
  </aside></div>;
}
