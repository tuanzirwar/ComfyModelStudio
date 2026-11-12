import type {FindMatch} from './PromptFind';
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject, CSSProperties } from 'react';
import { promptSegments } from './prompt-hover';
export function PromptPaint({ textarea, value,findMatch }: {findMatch?:FindMatch|null; textarea: RefObject<HTMLTextAreaElement|null>; value: string }) {
  const [style,setStyle]=useState<CSSProperties>({}), content=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const field=textarea.current;if(!field)return;
    const update=()=>{const css=getComputedStyle(field),next:Record<string,string>={width:`${field.clientWidth}px`,boxSizing:'border-box'};for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textAlign','textIndent','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak','overflowWrap'] as const)next[key]=css[key];setStyle(next);};
    const scroll=()=>{if(content.current)content.current.style.transform=`translate(${-field.scrollLeft}px,${-field.scrollTop}px)`;};
    update();scroll();const observer=new ResizeObserver(update);observer.observe(field);field.addEventListener('scroll',scroll);return()=>{observer.disconnect();field.removeEventListener('scroll',scroll);};
  },[textarea,value]);
  const highlight=(text:string,start:number)=>{if(!findMatch||start>=findMatch.end||start+text.length<=findMatch.start)return text;const from=Math.max(0,findMatch.start-start),to=Math.min(text.length,findMatch.end-start);return <>{text.slice(0,from)}<span className="prompt-find-current">{text.slice(from,to)}</span>{text.slice(to)}</>;};
  const segments=promptSegments(value);let offset=0;
  return <div className="prompt-paint" aria-hidden="true"><div ref={content} style={style}>{segments.map((segment,index)=>{const separator=highlight(value.slice(offset,segment.start),offset);offset=segment.end;return <span key={index}>{separator}<mark className={`prompt-token tone-${index%8}`}>{highlight(segment.text,segment.start)}</mark></span>;})}{highlight(value.slice(offset),offset)}{'\n'}</div></div>;
}
