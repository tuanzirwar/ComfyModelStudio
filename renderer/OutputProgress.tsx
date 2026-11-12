import './output-progress.css';
export function OutputProgress({progress,compact=false}:any){
 if(!progress)return null;const current=compact?progress:progress.current,percent=current?.percent;
 if(compact&&percent==null)return null;
 return <div className={`output-generation-progress ${compact?'compact':''}`} role="status"><div><strong>{current?(percent==null?'等待采样进度':`当前采样 ${percent}%`):'等待下一张'}</strong>{!compact&&<span>本批次已完成 {progress.completed} / {progress.total} 张{current?.name?` · ${current.name}`:''}</span>}</div>{current&&<progress aria-label="当前采样进度" max={100} value={percent??undefined}/>}</div>;
}
