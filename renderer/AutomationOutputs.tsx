import {OutputProgress} from './OutputProgress';
import { Select } from './Select';
import { useEffect, useMemo, useState } from 'react';
import { Workflow, Images, FolderOpen, FileDown, Copy, Search, X, SlidersHorizontal, Image as ImageIcon, ChevronLeft, ChevronRight, Clock3, Check, CheckCheck, RotateCcw, ListOrdered, Loader2 } from 'lucide-react';
import { PublishAlbum } from './ImageAlbums';
import { BatchControls, runLabels } from './WorkflowControls';
import { OutputDirectorySetting } from './OutputDirectory';
import { OutputProfile } from './OutputProfile';
import { DeleteBatch } from './DeleteBatch';
import './outputs.css';

type Any = Record<string, any>;
const api = (method: string, payload?: any) => window.studio.call(method, payload);
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const reviewLabels: Any = { all: '全部备选', pending: '待挑选', kept: '已保留', discarded: '已排除' };
function Action({ icon: Icon, children, primary, ...props }: any) { return <button className={`button ${primary ? 'primary' : ''}`} {...props}>{Icon && <Icon size={15}/>}<span>{children}</span></button>; }

export function AutomationOutputs({ data, run, busy, notify, openRecords }: any) {
  const collections: Any[] = data.automationOutputs?.collections || [];
  const [flow, setFlow] = useState('all'), [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [reviewFilter, setReviewFilter] = useState('all');
  const [detail, setDetail] = useState<Any | null>(null), [viewer, setViewer] = useState<{ keys: string[]; index: number } | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const flows = [...new Set(collections.map(collection => collection.name))];
  const batches = collections.filter(collection => flow === 'all' || collection.name === flow);
  const batch = batches.find(collection => collection.id === selected) || batches[0];
  const entries = useMemo(() => (batch?.items || []).flatMap((item: Any) => item.outputs.map((output: Any) => ({ item, output }))).sort((a: Any, b: Any) => a.item.taskOrder - b.item.taskOrder || a.item.group - b.item.group || a.item.image - b.item.image || a.item.order - b.item.order || a.output.index - b.output.index), [batch]);
  const groups = useMemo(() => {
    const groups = new Map<string, Any>();
    for (const item of [...(batch?.items || [])].sort((a, b) => a.taskOrder - b.taskOrder || a.order - b.order)) {
      if ((status === 'success' && !item.outputs.length) || (status === 'error' && !['failed', 'unknown', 'canceled'].includes(item.status))) continue;
      const outputs = item.outputs.filter((output: Any) => (reviewFilter === 'all' || output.reviewState === reviewFilter) && `${item.name} ${item.seed} ${output.filename} ${output.number || ''}`.toLowerCase().includes(query.toLowerCase()));
      const showPending = !item.outputs.length && reviewFilter === 'all' && `${item.name} ${item.seed}`.toLowerCase().includes(query.toLowerCase());
      if (!outputs.length && !showPending) continue;
      const key = item.taskId || `${item.taskOrder}:${item.name}`;
      if (!groups.has(key)) groups.set(key, { key, name: item.name, order: item.taskOrder, items: [] });
      groups.get(key)!.items.push({ ...item, outputs });
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [batch, query, status, reviewFilter]);
  const visible = groups.flatMap(group => group.items.flatMap((item: Any) => item.outputs.map((output: Any) => ({ item, output }))));
  const reviewBusy = busy.includes(`review-${batch?.id}`), numberingBusy = busy.includes('output-renumber');
  const generating = batch && ['running', 'pausing', 'preparing'].includes(batch.status);
  const large = viewer ? entries.find((entry: Any) => entry.output.key === viewer.keys[viewer.index]) : null;
  const copy = async (value: string, label = '已复制文件名') => { try { await navigator.clipboard.writeText(value); notify(label); } catch { notify('无法写入剪贴板，请手动复制', true); } };
  const review = async (list: Any[], state: string) => { if (!batch || !list.length) return; return run(`review-${batch.id}`, () => api('output:selection', { runId: batch.id, choices: list.map(({ output }) => ({ key: output.key, state })) })); };
  const moveViewer = (direction: number) => setViewer(current => current ? { ...current, index: (current.index + direction + current.keys.length) % current.keys.length } : current);
  const markViewer = async (state: string) => { if (!large || !viewer) return; const result = await review([large], state); if (result && autoNext) setViewer(current => current && current.keys[current.index] === large.output.key ? (current.index < current.keys.length - 1 ? { ...current, index: current.index + 1 } : null) : current); };
  useEffect(() => { setViewer(null); setDetail(null); }, [batch?.id]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return;
      if (event.key === 'Escape') { if (viewer) setViewer(null); else setDetail(null); return; }
      if (!viewer || !large) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveViewer(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); moveViewer(1); }
      if (!reviewBusy && ['k', 'x', 'u'].includes(event.key.toLowerCase())) { event.preventDefault(); void markViewer(({ k: 'kept', x: 'discarded', u: 'pending' } as Any)[event.key.toLowerCase()]); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [viewer, large, batch?.id, reviewBusy, autoNext]);
  const openDetails = async (item: Any, output: Any) => { const result = await run(`output-details-${item.id}`, () => api('output:details', { runId: batch.id, itemId: item.id })); if (result) setDetail({ ...result, item, output, runId: batch.id }); };
  const renumber = async () => { const result = await run('output-renumber', () => api('output:renumber', { runId: batch.id })); if (result) notify(`${result.reused ? '保留图编号已是最新' : '已保存保留图'} · ${result.count} 张 · 从 1 连续编号`); };

  return <>
    <div className="page-title"><div><div className="eyebrow">CURATE YOUR NEXT COLLECTION</div><h1>自动化输出<span className="title-dot">.</span></h1><p>先挑选喜欢的，再按配方流顺序收好。</p></div><div className="title-actions"><Action icon={FolderOpen} disabled={!batch?.outputCount} onClick={() => run('output-folder', () => api('output:folder', { runId: batch.id }))}>{batch?.legacy ? '整理并打开备选目录' : '备选图目录'}</Action><Action icon={FileDown} disabled={!batch?.outputCount || busy.includes('output-export')} onClick={async () => { const result = await run('output-export', () => api('output:export', { runId: batch.id })); if (result) notify(`已导出全部 ${result.count} 张备选图`); }}>导出全部备选</Action></div></div>
    <OutputDirectorySetting value={data.automationOutputs?.root} run={run} busy={busy} notify={notify}/>
    <div className="outputs-overview"><div><span className="summary-icon mint"><Workflow size={19}/></span><div><strong>{flows.length.toString().padStart(2, '0')}</strong><span>配方流</span></div></div><div><span className="summary-icon lavender"><Clock3 size={19}/></span><div><strong>{collections.length.toString().padStart(2, '0')}</strong><span>运行批次</span></div></div><div><span className="summary-icon peach"><Images size={19}/></span><div><strong>{collections.reduce((count, collection) => count + collection.outputCount, 0)}</strong><span>已生成备选</span></div></div><div className="outputs-naming-summary"><CheckCheck size={20}/><div><strong>挑选 → 保留 → 连续编号</strong><span>整条配方流统一从 1 开始</span></div></div></div>
    <div className="outputs-toolbar"><label className="flow-filter"><Workflow size={15}/><Select aria-label="按配方流筛选" value={flow} onChange={event => { setFlow(event.target.value); setSelected(''); }}><option value="all">全部配方流</option>{flows.map(name => <option key={name} value={name}>{name}</option>)}</Select></label><div className="search-field"><Search size={15}/><input aria-label="搜索自动化输出" placeholder="搜索配方、种子、编号或文件名…" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14}/></button>}</div><Select className="output-status-filter" aria-label="输出状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部任务</option><option value="success">已有图片</option><option value="error">异常 / 取消</option></Select></div>
    {!batch ? <div className="empty outputs-empty"><div className="empty-icon"><Images size={30}/></div><h3>从十张备选，选出喜欢的一张</h3><p>在自动化编排中设置每个配方的备选数量，生成后在这里挑选、保留并统一编号。</p></div> : <div className="outputs-layout">
      <aside className="output-batches"><div className="output-batches-caption">运行批次 <span>{batches.length}</span></div>{batches.map(collection => <button key={collection.id} className={collection.id === batch.id ? 'selected' : ''} onClick={() => setSelected(collection.id)}><span className="batch-card-top"><Workflow size={14}/><span>{collection.outputCount} 张</span></span><strong>{collection.name}</strong><span>{time(collection.createdAt)} · 保留 {collection.keptCount || 0}</span><small><i className={`tiny-dot ${['failed', 'unknown'].includes(collection.status) ? 'red' : ''}`}/>{runLabels[collection.status] || collection.status}</small>{collection.generationProgress?.current?.percent!=null&&<span className="batch-current-progress">当前采样 {collection.generationProgress.current.percent}%</span>}</button>)}</aside>
      <section className="flow-collection">
        <header className="flow-collection-heading"><div><span className="collection-eyebrow">RECIPE FLOW COLLECTION</span><h2>{batch.name}</h2><p>{time(batch.createdAt)}<span>·</span>{batch.outputCount} 张备选<span>·</span>{runLabels[batch.status] || batch.status}</p></div><div className="collection-heading-actions"><BatchControls batch={batch} run={run} busy={busy}/><DeleteBatch batch={batch} run={run} busy={busy} notify={notify} onDeleted={() => { setSelected(''); setFlow('all'); setViewer(null); setDetail(null); }}/><span className="collection-seal"><Workflow size={24}/></span></div></header>
        {['running','pausing','paused','preparing','unknown'].includes(batch.status)&&<OutputProgress progress={batch.generationProgress}/>}
        <div className="output-directory"><FolderOpen size={15}/><code title={batch.folderPath}>{batch.folderPath}</code><button className="icon-button" aria-label="复制本批次输出目录" onClick={() => copy(batch.folderPath, '已复制本批次输出目录')}><Copy size={14}/></button></div>
        <section className="curation-bar" aria-label="保留与编号"><div className="curation-count"><CheckCheck size={21}/><div><strong>已保留 {batch.keptCount} <span>/ {batch.outputCount} 张</span></strong><small>{batch.keptCount ? `编号预览 1 — ${batch.keptCount}` : '点击图片左上角，选出要保留的图片'}{batch.keptOutput && (batch.numberingDirty ? ' · 选择已改变，编号待更新' : ' · 编号已保存')}</small></div></div><div className="curation-main-actions"><Action icon={FolderOpen} disabled={!batch.keptOutput} onClick={() => run('kept-folder', () => api('output:kept-folder', { runId: batch.id }))}>保留图目录</Action><Action icon={ListOrdered} primary disabled={!batch.keptCount || generating || numberingBusy || reviewBusy} onClick={renumber}>{numberingBusy ? '正在保存…' : '重新编号'}</Action><PublishAlbum batch={batch} run={run} busy={busy} notify={notify} onPublished={openRecords}/></div><p>原始输出完整保留。筛选后填写图片集名称并保存，才会进入生成记录；编号按整条流顺序从 1 开始。</p></section>
        <div className="curation-filter-row"><div className="review-tabs" role="group" aria-label="图片挑选状态">{Object.entries(reviewLabels).map(([value, label]) => <button key={value} className={reviewFilter === value ? 'selected' : ''} onClick={() => setReviewFilter(value)}>{String(label)} <span>{({ all: batch.outputCount, pending: batch.pendingCount, kept: batch.keptCount, discarded: batch.discardedCount } as Any)[value]}</span></button>)}</div><Action icon={FileDown} disabled={!batch.keptCount || generating || busy.includes('kept-export')} onClick={async () => { const result = await run('kept-export', () => api('output:kept-export', { runId: batch.id })); if (result) notify(`已导出 ${result.count} 张保留图及编号清单`); }}>导出保留图</Action></div>
        <div className="curation-bulk"><span>当前显示 {visible.length} 张</span><button disabled={!visible.length || reviewBusy} onClick={() => review(visible, 'kept')}><CheckCheck size={13}/>保留当前显示</button><button disabled={!visible.length || reviewBusy} onClick={() => review(visible, 'discarded')}><X size={13}/>排除当前显示</button><button disabled={!visible.length || reviewBusy} onClick={() => review(visible, 'pending')}><RotateCcw size={12}/>恢复待选</button></div>
        {!groups.length ? <div className="empty"><div className="empty-icon"><Search size={25}/></div><h3>{reviewFilter === 'pending' && batch.outputCount ? '当前范围已挑选完成' : '没有匹配的图片'}</h3><p>可以切换挑选状态，或清除搜索条件。</p></div> : groups.map(group => {
          const groupEntries = group.items.flatMap((item: Any) => item.outputs.map((output: Any) => ({ item, output })));
          return <section className="output-recipe-group" key={group.key}><header><span className="recipe-sequence">{String(group.order).padStart(2, '0')}</span><div><h3>{group.name}</h3><p>显示 {groupEntries.length} 张 · 保留 {groupEntries.filter((entry: Any) => entry.output.reviewState === 'kept').length} 张</p></div><div className="recipe-review-actions"><button disabled={!groupEntries.length || reviewBusy} onClick={() => review(groupEntries, 'kept')}>全选本组</button><button disabled={!groupEntries.length || reviewBusy} onClick={() => review(groupEntries, 'pending')}>重选</button></div></header>
            <div className="outputs-image-grid">{group.items.flatMap((item: Any) => item.outputs.length ? item.outputs.map((output: Any) => <article className={`output-image-card review-${output.reviewState}`} key={output.key}>
              <div className="review-image-frame"><button className="output-image-preview" aria-label={`预览 ${output.filename}`} onClick={() => setViewer({ keys: visible.map((entry: Any) => entry.output.key), index: visible.findIndex((entry: Any) => entry.output.key === output.key) })}><img src={output.src} alt={`${item.name} · 第 ${item.group} 组第 ${item.image} 张`} loading="lazy"/><span className="output-order-label">第 {item.group} 组 · {item.image}</span></button><button className={`retain-toggle ${output.reviewState === 'kept' ? 'selected' : ''}`} role="checkbox" aria-checked={output.reviewState === 'kept'} aria-label={`保留 ${item.name} 第 ${item.image} 张`} disabled={reviewBusy} onClick={() => review([{ item, output }], output.reviewState === 'kept' ? 'pending' : 'kept')}>{output.reviewState === 'kept' ? <Check size={15}/> : <span/>}</button>{output.number && <span className="kept-number">#{output.number}</span>}{output.reviewState === 'discarded' && <span className="discarded-label">已排除</span>}</div>
              <div className="output-image-info"><button className="output-filename" title={`点击复制：${output.filename}`} onClick={() => copy(output.filename)}>{output.filename}</button><div className="output-image-meta"><span>Seed <b>{item.seed}</b></span><button className="review-reject" disabled={reviewBusy} onClick={() => review([{ item, output }], output.reviewState === 'discarded' ? 'pending' : 'discarded')}>{output.reviewState === 'discarded' ? '恢复待选' : '排除'}</button></div><div className="output-image-actions"><button onClick={() => openDetails(item, output)}><SlidersHorizontal size={13}/>参数与提示词</button><button aria-label="在本地查看图片" onClick={() => api('run:reveal', { runId: batch.id, itemId: item.id, index: output.index })}><FolderOpen size={14}/></button></div></div>
            </article>) : [<article className={`output-pending-card state-${item.status}`} key={item.id}><span className="pending-symbol">{['running', 'remote_queued', 'submitting', 'archiving'].includes(item.status) ? <Loader2 className="spin" size={24}/> : <ImageIcon size={27}/>}</span><strong>{runLabels[item.status] || item.status}</strong>{['running','archiving'].includes(item.status)&&<OutputProgress compact progress={item.progress}/>}<span>第 {item.group} 组 · 第 {item.image} 张</span><small>Seed {item.seed}</small>{item.error && <p title={item.error}>{item.error}</p>}{['failed', 'unknown', 'canceled'].includes(item.status) && <button className="button" disabled={generating || busy.includes('retry-run')} onClick={() => run('retry-run', () => api('run:action', { runId: batch.id, itemId: item.id, action: 'retry' }), '已创建新的重试任务')}>重试并继续</button>}</article>])}</div>
          </section>;
        })}
        <div className="outputs-footnote"><ListOrdered size={15}/><span>编号覆盖此批次全部配方的保留图片。大图预览可用 ← → 切换，K 保留、X 排除、U 恢复待选。</span></div>
      </section>
    </div>}
    {detail && <OutputProfile detail={detail} close={() => setDetail(null)} copy={copy}/>}
    {viewer && large && <div className="image-lightbox curation-lightbox" role="dialog" aria-modal="true" aria-label="备选图挑选预览"><button className="icon-button viewer-close" aria-label="关闭图片预览" onClick={() => setViewer(null)}><X size={22}/></button><button className="viewer-nav previous" aria-label="上一张" onClick={() => moveViewer(-1)}><ChevronLeft size={25}/></button><div className="viewer-image"><img src={large.output.src} alt={large.item.name}/><div><strong>{large.item.name}</strong><span>{viewer.index + 1} / {viewer.keys.length} · Seed {large.item.seed}{large.output.number ? ` · 保留编号 #${large.output.number}` : ''}</span></div></div><button className="viewer-nav next" aria-label="下一张" onClick={() => moveViewer(1)}><ChevronRight size={25}/></button><div className="viewer-review"><Action icon={Check} primary={large.output.reviewState === 'kept'} disabled={reviewBusy} onClick={() => markViewer('kept')}>保留 K</Action><Action icon={X} disabled={reviewBusy} onClick={() => markViewer('discarded')}>排除 X</Action><Action icon={RotateCcw} disabled={reviewBusy} onClick={() => markViewer('pending')}>待选 U</Action><label className="viewer-auto-next"><input type="checkbox" checked={autoNext} onChange={event => setAutoNext(event.target.checked)}/>标记后下一张</label><span>← → 切换</span></div></div>}
  </>;
}
