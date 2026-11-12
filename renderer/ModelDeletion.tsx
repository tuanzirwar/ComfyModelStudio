import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X, Loader2, FolderOpen, RotateCcw, ArchiveRestore } from 'lucide-react';
import './model-deletion.css';
type Any = Record<string, any>;
const api = (method: string, payload?: any) => window.studio.call(method, payload);
const size = (value: number) => value > 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
function ModelModal({ title, children, close, disabled = false }: any) {
  const panel = useRef<HTMLElement>(null), closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; panel.current?.querySelector<HTMLElement>('[data-cancel]')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!disabled) closeRef.current(); }
      if (event.key === 'Tab') { const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || [])]; const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    window.addEventListener('keydown', listener, true); return () => { window.removeEventListener('keydown', listener, true); if (previous?.isConnected) previous.focus(); };
  }, [disabled]);
  return createPortal(<div className="overlay model-removal-overlay" onMouseDown={event => { if (!disabled && event.target === event.currentTarget) close(); }}><section ref={panel} className="modal model-removal-modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2><p>由你选择如何处理模型与配套资料。</p></div><button className="icon-button" disabled={disabled} aria-label="关闭模型删除窗口" onClick={close}><X size={20}/></button></header>{children}</section></div>, document.body);
}

export function DeleteModel({ model, run, busy, notify, onDeleted }: any) {
  const [preview, setPreview] = useState<Any | null>(null), [mode, setMode] = useState('trash');
  const loading = busy.includes(`model-delete-preview-${model.id}`), deleting = busy.includes(`model-delete-${model.id}`);
  useEffect(() => { setPreview(null); }, [model.id]);
  return <><button className="button danger-text" disabled={loading || deleting || busy.includes(model.id)} onClick={async () => { const result = await run(`model-delete-preview-${model.id}`, () => api('model:delete-preview', { id: model.id })); if (result) { setPreview(result); setMode(result.recycleError || !result.artifacts.length ? 'index' : 'trash'); } }}>{loading ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>}删除模型</button>
    {preview && preview.id === model.id && <ModelModal title="删除这个模型？" disabled={deleting} close={() => setPreview(null)}><div className="modal-body"><div className="model-removal-heading"><Trash2 size={25}/><div><strong>{preview.name}</strong><span>{preview.type} · 约 {size(preview.size)}</span></div></div><div className="model-removal-path"><FolderOpen size={15}/><code>{preview.path}</code></div>
      <fieldset className="model-removal-modes"><legend>处理方式</legend><label className={mode === 'trash' ? 'selected' : ''}><input type="radio" name="model-delete-mode" checked={mode === 'trash'} disabled={Boolean(preview.recycleError) || !preview.artifacts.length || deleting} onChange={() => setMode('trash')}/><span><strong>将模型和配套资料移入回收站</strong><small>包括模型文件及同名 .cms 文件夹里的封面、README、详情和自定义分类。可从 Windows 回收站找回。</small></span></label><label className={mode === 'index' ? 'selected' : ''}><input type="radio" name="model-delete-mode" checked={mode === 'index'} disabled={deleting} onChange={() => setMode('index')}/><span><strong>仅从模型库移除，保留硬盘文件</strong><small>后续扫描不会自动加回；可在模型库的“已移除模型”中重新收录。</small></span></label></fieldset>
      {preview.recycleError && <p className="model-removal-note">{preview.recycleError}</p>}
      {mode === 'trash' && <details className="model-removal-artifacts"><summary>将移入回收站的项目 · {preview.artifacts.length} 项</summary>{preview.artifacts.map((item: Any) => <code key={item.path}>{item.path}{item.folder ? '（整个资料文件夹）' : ''}</code>)}</details>}
      {(preview.recipes.length > 0 || preview.taskCount > 0) && <div className="model-removal-references"><strong>有 {preview.recipes.length} 个配方、{preview.taskCount} 个编排任务引用此模型</strong><p>配方会保留。删除后需更换模型或重新收录，才能再次使用。</p>{preview.recipes.slice(0, 8).map((recipe: Any) => <span key={recipe.id}>{recipe.name}</span>)}</div>}
      <p className="model-removal-note">已生成图片、图片集与运行快照保留。模型目录中相邻的外部预览图和其他工具资料不会清理。</p>{preview.blockedReason && <p className="inline-error" role="alert">{preview.blockedReason}</p>}
      </div><footer className="modal-footer"><span className="model-removal-note">请确认路径与处理方式</span><div><button data-cancel className="button" disabled={deleting} onClick={() => setPreview(null)}>取消</button><button className="button record-delete-confirm" disabled={deleting || Boolean(preview.blockedReason) || (mode === 'trash' && Boolean(preview.recycleError))} onClick={async () => { const result = await run(`model-delete-${model.id}`, () => api('model:delete', { id: model.id, mode, expectedPath: preview.path, revision: preview.revision })); if (result) { setPreview(null); onDeleted?.(); notify(result.mode === 'trash' ? '模型和配套资料已移入回收站' : '已从模型库移除，硬盘文件保留'); } }}>{deleting ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>} {deleting ? '正在处理…' : mode === 'trash' ? '移入回收站' : '仅移除库记录'}</button></div></footer></ModelModal>}
  </>;
}

export function RemovedModels({ count, run, busy, notify }: any) {
  const [items, setItems] = useState<Any[] | null>(null);
  const restoring = busy.some((key: string) => key.startsWith('restore-model-'));
  const load = async () => { const result = await run('removed-models', () => api('model:removed')); if (result) setItems(result); };
  return <><button className="button removed-models-entry" disabled={!count || busy.includes('removed-models')} onClick={load}><ArchiveRestore size={15}/>已移除模型{count ? ` · ${count}` : ''}</button>{items && <ModelModal title="已移除的模型" disabled={restoring} close={() => setItems(null)}><div className="modal-body"><p className="model-removal-note">此列表不会自动重新收录模型。已回收的文件需先在 Windows 回收站还原，刷新列表后再点击重新收录。</p><div className="removed-models-list">{items.length ? items.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{item.type} · {item.exists ? '模型文件在本地' : '模型文件不在原位置'}</span><code>{item.path}</code></div><button className="button" disabled={!item.exists || restoring} onClick={async () => { const result = await run(`restore-model-${item.id}`, () => api('model:restore', { id: item.id })); if (result) { await load(); notify('已重新收录模型'); } }}>{busy.includes(`restore-model-${item.id}`) ? <Loader2 size={14} className="spin"/> : <RotateCcw size={14}/>}重新收录</button></article>) : <p className="model-removal-note">没有已移除的模型。</p>}</div></div><footer className="modal-footer"><div><button className="button" disabled={restoring || busy.includes('removed-models')} onClick={load}><RotateCcw size={14}/>刷新列表</button><button data-cancel className="button" disabled={restoring} onClick={() => setItems(null)}>关闭</button></div></footer></ModelModal>}</>;
}
