import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { promptCaretPoint } from './prompt-hover';
export function PromptSuggestions({ textarea, query, more, hasMore, rows, active, loading, error, choose, close, listId }: { textarea: RefObject<HTMLTextAreaElement | null>; query: string; more: () => void; hasMore: boolean; rows: any[]; active: number; loading: boolean; error: string; choose: (tag: string) => void; close: () => void; listId: string }) {
  const ref = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const update = () => { const field = textarea.current, popup = ref.current; if (!field || !popup) return; const point = promptCaretPoint(field, field.selectionStart), bounds = field.getBoundingClientRect(), rect = popup.getBoundingClientRect(); const y = Math.max(bounds.top, Math.min(point.y, bounds.bottom)); setPosition({ left: Math.max(8, Math.min(point.x, innerWidth - rect.width - 8)), top: Math.max(8, y + 8 + rect.height > innerHeight - 8 ? y - rect.height - 24 : y + 8) }); };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true); return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [textarea, query, rows, loading, error]);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  return createPortal(<div ref={ref} className="prompt-suggestions" style={position} onMouseDown={e => e.preventDefault()}><header><span>提示词候选 · {rows.length}{hasMore ? '＋' : ''}</span><button type="button" onClick={close}>保留原文 <kbd>Esc</kbd></button></header><div role="listbox" id={listId} aria-label="提示词候选">{rows.map((row, i) => <button type="button" tabIndex={-1} role="option" id={`${listId}-${i}`} aria-selected={i === active} key={`${row.en}-${i}`} onClick={() => choose(row.en)}><strong>{row.zh}</strong><code>{row.en.replaceAll('_',' ')}</code></button>)}{hasMore && <button type="button" className="prompt-more" disabled={loading} onClick={more}>加载更多匹配</button>}{loading && <p>正在匹配…</p>}{!loading && !rows.length && <p>{error || '暂无匹配项，可继续输入原文。'}</p>}</div><footer>Tab / 点击采用 · ↑↓选择后回车确认 · Esc 保留原文</footer></div>, document.body);
}
