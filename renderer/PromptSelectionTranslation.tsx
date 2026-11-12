import { useEffect, useState } from 'react';
import { promptSegments } from './prompt-hover';
import './prompt-selection.css';

type Entry = { text: string; result?: any; error?: boolean };
export function PromptSelectionTranslation({ text, dismiss }: { text: string; dismiss: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]), [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const rows: Entry[] = promptSegments(text).map(segment => ({ text: segment.text.trim() }));
    setEntries(rows); setLoading(true);
    const timer = setTimeout(async () => {
      // Bounded IPC batches keep large selections responsive without truncating them.
      for (let i = 0; i < rows.length && alive; i += 128) {
        const batch = rows.slice(i, i + 128);
        try {
          const translated = await window.studio.call('prompt:translate-many', { texts: batch.map(row => row.text) });
          if (!alive) return;
          batch.forEach((row, j) => { row.result = translated[j]; });
        } catch { if (!alive) return; batch.forEach(row => { row.error = true; }); }
        setEntries(rows.map(row => ({ ...row })));
      }
      if (alive) setLoading(false);
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [text]);
  const complete = entries.filter(row => row.result?.match === 'full').length;
  const partial = entries.filter(row => row.result?.match === 'partial').length;
  const unknown = entries.filter(row => row.error || row.result?.match === 'none').length;
  return <section className="prompt-selection" aria-label="框选提示词中文对照" aria-busy={loading}>
    <header><div><strong>选中内容 · 中文对照</strong><small role="status">{entries.length} 个词组 · {loading ? '正在翻译…' : `${complete} 已匹配 · ${partial} 部分匹配 · ${unknown} 未收录或查询失败`}</small></div><button type="button" onClick={dismiss} aria-label="关闭框选翻译">×</button></header>
    <div className="selection-translation-grid">{entries.map((row, index) => <article key={index} title={row.result?.zh || row.text} className={`translation-block tone-${index % 8} ${row.result?.match === 'none' || row.error ? 'untranslated' : ''}`}>
      <div className="translation-block-source"><span>{String(index + 1).padStart(2, '0')}</span><code>{row.text}</code></div>
      <p>{row.error ? '查询失败' : !row.result ? '翻译中…' : row.result.match === 'full' ? row.result.zh.split(' / ').slice(0,2).join(' / ') : row.result.match === 'partial' ? row.result.parts.map((part: any) => part.zh).join(' · ') : /[\u3400-\u9fff]/.test(row.text) ? '中文' : '未收录'}</p>
      {row.result?.match === 'partial' && <small>部分匹配{row.result.unknown?.length ? ' · 含未收录词' : ''}</small>}
    </article>)}</div><footer>相同色块内上下对应 · 保留原词与权重 · 仅供理解，不改写提示词</footer>
  </section>;
}
