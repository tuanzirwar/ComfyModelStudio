const generating=new Set(['running','submitting','remote_queued','archiving']);
export function itemProgress(item) {
 const value=Number(item.progress?.value),max=Number(item.progress?.max);
 return {value:Number.isFinite(value)?value:0,max:Number.isFinite(max)?max:0,percent:item.status==='succeeded'?100:Number.isFinite(value)&&Number.isFinite(max)&&max>0?Math.round(Math.min(1,Math.max(0,value/max))*100):null};
}
export function runProgress(run) {
 const items=(run.items||[]).filter(item=>item.status!=='superseded'&&!item.retriedBy),current=items.find(item=>generating.has(item.status));
 return {completed:items.filter(item=>item.status==='succeeded').length,total:items.length,current:current?{id:current.id,name:current.name,status:current.status,...itemProgress(current)}:null};
}
export function applyProgressEvent(item,event) {
 if(event.type==='executing'){const node=event.data.node;if(node&&String(node)!==String(item.nodeId))item.progress={value:0,max:0};item.nodeId=node;if(node)item.status='running';}
 if(event.type==='progress')item.progress={value:event.data.value,max:event.data.max};
}
