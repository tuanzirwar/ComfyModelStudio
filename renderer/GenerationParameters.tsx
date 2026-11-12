import { useState } from 'react';
import { Select } from './Select';
import './generation-parameters.css';
export const resolutionPresets = [
  ['21:9',1536,640],['16:9',1344,768],['3:2',1216,832],['4:3',1152,896],['1:1',1024,1024],['3:4',896,1152],['2:3',832,1216],['9:16',768,1344],['9:21',640,1536],
] as const;
const samplers = ['euler','euler_ancestral','heun','dpm_2','dpmpp_2m','dpmpp_2m_sde','dpmpp_sde','ddim','lcm'];
const schedulers = ['normal','karras','exponential','sgm_uniform','simple','ddim_uniform','beta'];
export function GenerationParameters({ value, onChange, choices }: any) {
  const [more,setMore] = useState(false);
  const change = (key: string, input: any) => onChange({ ...value, [key]: input });
  const current = resolutionPresets.find(p => p[1] === Number(value.width) && p[2] === Number(value.height));
  const picker = (key: string, label: string, options: string[]) => <label className="field"><span>{label}</span><Select aria-label={label} value={value[key]} onChange={event => change(key,event.target.value)}>{[...new Set([value[key],...options])].filter(Boolean).map(option=><option key={option} value={option}>{option}</option>)}</Select></label>;
  return <section className="generation-parameters">
    <header><strong>画幅与分辨率</strong><span>{value.width} × {value.height}</span></header>
    <div className="resolution-presets" role="group" aria-label="分辨率预设">{resolutionPresets.filter(p=>more||['3:2','1:1','3:4'].includes(p[0])||p===current).map(p=><button type="button" key={p[0]} aria-pressed={p===current} className={p===current?'selected':''} onClick={()=>onChange({...value,width:p[1],height:p[2]})}><i style={{aspectRatio:`${p[1]} / ${p[2]}`,width:p[1]>=p[2]?30:22,height:p[1]>=p[2]?undefined:28}}/><strong>{p[0]}</strong><small>{p[1]} × {p[2]}</small></button>)}<button type="button" aria-expanded={more} onClick={()=>setMore(!more)}><span className="resolution-more">{more?'−':'+'}</span><strong>{more?'收起':'更多'}</strong><small>预设 / 自定义</small></button></div>
    {(more||!current)&&<div className="parameter-grid">{[['width','宽度'],['height','高度']].map(([key,label])=><label className="field" key={key}><span>{label}</span><input aria-label={label} type="number" min="64" max="16384" step="16" value={value[key]} onChange={event=>change(key,Number(event.target.value))}/></label>)}</div>}
    <div className="generation-sliders">{[['cfg','CFG Scale',0,30,.5],['steps','采样步数',1,100,1],['denoise','降噪',0,1,.05]].map(([key,label,min,max,step])=><label className="generation-slider" key={key}><span>{label}</span><input aria-label={`${label}滑块`} type="range" min={min} max={max} step={step} value={Math.min(Number(max),value[key]??1)} onChange={event=>change(String(key),Number(event.target.value))}/><input aria-label={String(label)} type="number" min={min} max={key==='steps'?1000:key==='cfg'?100:max} step={step} value={value[key]??1} onChange={event=>change(String(key),Number(event.target.value))}/></label>)}</div>
    <div className="parameter-grid">{picker('sampler','采样器',choices?.samplers?.length?choices.samplers:samplers)}{picker('scheduler','调度器',choices?.schedulers?.length?choices.schedulers:schedulers)}<label className="field"><span>种子</span><input aria-label="种子" inputMode="numeric" value={value.seed} onChange={event=>change('seed',event.target.value)}/></label><label className="field"><span>种子策略</span><Select aria-label="种子策略" value={value.seedPolicy} onChange={event=>change('seedPolicy',event.target.value)}><option value="fixed">固定</option><option value="increment">递增</option><option value="random">随机</option></Select></label></div>
  </section>;
}
