import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createPromptHitTest } from './prompt-hover';
import './prompt-translation.css';
type Hover = { x: number; y: number; text: string; result?: any; error?: boolean };
const cache = new Map<string, any>();
function TranslationTip({ hover }: { hover: Hover }) {
  const ref = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ left: hover.x + 12, top: hover.y + 18 });
  useLayoutEffect(() => { const rect = ref.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(hover.x + 12, innerWidth - rect.width - 8)), top: Math.max(8, hover.y + 18 + rect.height > innerHeight - 8 ? hover.y - rect.height - 12 : hover.y + 18) }); }, [hover]);
  const result = hover.result;
  return createPortal(<div ref={ref} className="prompt-translation-tip" role="tooltip" style={position}><small>中文释义</small><div className="translation-original">{hover.text.trim()}</div>{hover.error ? <p>暂时无法查询本地词库</p> : !result ? <p>正在查词…</p> : result.match === 'full' ? <strong>{result.zh.split(' / ').slice(0, 3).join(' / ')}</strong> : result.match === 'partial' ? <><small>分词释义</small><dl>{result.parts.slice(0, 6).map((part: any, i: number) => <div key={i}><dt>{part.en}</dt><dd>{part.zh.split(' / ').slice(0, 2).join(' / ')}</dd></div>)}</dl>{result.unknown.length > 0 && <p className="translation-unknown">未收录：{result.unknown.join(' ')}</p>}</> : <p>本地词库暂无对应译文</p>}</div>, document.body);
}
export function PromptTranslation({ textarea, value, disabled = false }: { textarea: RefObject<HTMLTextAreaElement | null>; value: string; disabled?: boolean }) {
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => {
    setHover(null);
    const field = textarea.current; if (!field || disabled) return;
    let mirror: ReturnType<typeof createPromptHitTest> | undefined, timer: ReturnType<typeof setTimeout> | undefined, frame = 0, key = '', sequence = 0, alive = true;
    setHover(null);
    const clear = () => { sequence++; key = ''; clearTimeout(timer); cancelAnimationFrame(frame); setHover(null); };
    const move = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      if (event.buttons) { clear(); return; }
      frame = requestAnimationFrame(() => {
        if (!mirror?.valid()) { mirror?.remove(); mirror = createPromptHitTest(field); }
        const segment = mirror.hit(event.clientX, event.clientY), next = segment ? `${segment.start}:${segment.text}` : '';
        if (key === next) { setHover(previous => previous ? { ...previous, x: event.clientX, y: event.clientY } : previous); return; }
        clear(); key = next; if (!segment || !/[a-zA-Z]/.test(segment.text)) return;
        const current = sequence, x = event.clientX, y = event.clientY, text = segment.text;
        timer = setTimeout(() => {
          const cached = cache.get(text);
          setHover({ x, y, text, result: cached }); if (cached) return;
          void window.studio.call('prompt:translate', { text }).then(result => {
            if (cache.size >= 512) cache.delete(cache.keys().next().value!); cache.set(text, result);
            if (alive && sequence === current) setHover({ x, y, text, result });
          }).catch(() => { if (alive && sequence === current) setHover({ x, y, text, error: true }); });
        }, 280);
      });
    };
    field.addEventListener('mousemove', move);
    window.addEventListener('resize', clear); window.addEventListener('scroll', clear, true);
    for (const event of ['mouseleave','scroll','keydown','blur','mousedown']) field.addEventListener(event, clear);
    return () => { alive = false; sequence++; clearTimeout(timer); cancelAnimationFrame(frame); mirror?.remove(); field.removeEventListener('mousemove', move); window.removeEventListener('resize', clear); window.removeEventListener('scroll', clear, true); for (const event of ['mouseleave','scroll','keydown','blur','mousedown']) field.removeEventListener(event, clear); };
  }, [textarea, value, disabled]);
  return hover ? <TranslationTip hover={hover}/> : null;
}
