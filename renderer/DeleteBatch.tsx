import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X, FolderOpen, Loader2 } from 'lucide-react';
import './records.css';

type Any = Record<string, any>;
const api = (method: string, payload?: any) => window.studio.call(method, payload);

export function DeleteBatch({ batch, run, busy, notify, onDeleted }: any) {
  const [preview, setPreview] = useState<Any | null>(null), [trashFiles, setTrashFiles] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const key = `delete-batch-${batch.id}`, deleting = busy.includes(key), loading = busy.includes(`${key}-preview`);
  const active = ['running', 'pausing', 'preparing'].includes(batch.status) || (!['failed', 'unknown', 'canceled'].includes(batch.status) && batch.items.some((item: Any) => ['submitting', 'remote_queued', 'running', 'archiving', 'unknown'].includes(item.status)));
  const close = () => { if (!deleting) { setPreview(null); trigger.current?.focus(); } };
  useEffect(() => { setPreview(null); setTrashFiles(true); }, [batch.id]);
  useEffect(() => {
    if (!preview) return;
    panel.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        if (!panel.current) return;
        const nodes = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true);
  }, [preview, deleting]);
  return <>
    <button ref={trigger} className="button danger-text batch-delete-button" disabled={active || loading || deleting} title={active ? '请先取消或完成当前批次；状态未确认的任务需要先对账或取消' : '删除原始批次，已保存图片集不受影响'} onClick={async () => { const result = await run(`${key}-preview`, () => api('run:delete-preview', { runId: batch.id })); if (result) { setTrashFiles(true); setPreview(result); } }}>{loading ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>}<span>删除批次</span></button>
    {preview && preview.runId === batch.id && createPortal(<div className="overlay record-delete-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section ref={panel} className="modal record-delete-modal" role="dialog" aria-modal="true" aria-labelledby="record-delete-title" aria-describedby="record-delete-description">
      <header className="modal-header"><div><h2 id="record-delete-title">删除这个批次？</h2><p>从自动化输出移除此原始批次，已保存图片集保留。</p></div><button className="icon-button" aria-label="关闭删除窗口" disabled={deleting} onClick={close}><X size={19}/></button></header>
      <div className="modal-body"><div className="record-delete-summary"><span><Trash2 size={23}/></span><div><strong>{preview.name}</strong><p>{preview.outputCount} 张生成结果 · {preview.kind === 'plan' ? '自动化配方流' : '单次配方'}</p></div></div>
        <p id="record-delete-description" className="record-delete-description">默认删除批次记录，并将本批次管理的原始备选图移入回收站。已保存图片集、配方和编排保留；也可取消下方选项，仅移除记录。</p>
        {preview.folderPath && <div className="record-delete-path"><FolderOpen size={15}/><code>{preview.folderPath}</code></div>}
        <label className={`record-delete-option ${trashFiles ? 'selected' : ''}`}><input type="checkbox" checked={trashFiles} disabled={deleting || !preview.fileCount || Boolean(preview.blockedReason)} onChange={event => setTrashFiles(event.target.checked)}/><span><strong>同时将本批次图片移入回收站</strong><small>将清理 {preview.imageCount} 张本地备选图与各版编号保留图，以及对应输出清单。ComfyUI 原始输出和另行导出的副本保留。</small></span></label>
        {preview.skippedCount > 0 && <p className="record-delete-note">有 {preview.skippedCount} 个共享或路径不匹配的文件会保留。</p>}
        {preview.blockedReason && <p className="inline-error" role="alert">{preview.blockedReason}</p>}
        {preview.cancelBeforeDelete && <p className="record-delete-note">删除前会先取消本批次尚未结束的任务；取消失败时保留记录。其他批次不受影响。</p>}
      </div>
      <footer className="modal-footer"><span className="record-delete-note">{trashFiles ? '图片可从 Windows 回收站找回。' : '删除后，记录无法在工具内恢复。'}</span><div><button data-cancel className="button" disabled={deleting} onClick={close}>取消</button><button className="button record-delete-confirm" disabled={deleting || Boolean(preview.blockedReason)} onClick={async () => {
        const result = await run(key, () => api('run:delete', { runId: preview.runId, trashFiles }));
        if (result) { setPreview(null); onDeleted?.(); notify(trashFiles ? `批次已删除 · ${result.movedCount} 个文件已移入回收站${result.skippedCount ? ' · 共享文件已保留' : ''}` : '批次记录已删除，图片保留在本地'); }
      }}>{deleting ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>}<span>{deleting ? '正在删除…' : trashFiles ? '删除记录并回收图片' : '仅删除记录'}</span></button></div></footer>
    </section></div>, document.body)}
  </>;
}
