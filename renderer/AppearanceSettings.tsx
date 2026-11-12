import { useState } from 'react';
import './appearance.css';
import './theme-palette.css';
export const themes = [
  { id:'aurora', name:'极光蓝', description:'石墨深底 · 冰蓝与淡紫', colors:['#111722','#233652','#9bbfff'] },
  { id:'obsidian', name:'星云紫', description:'墨黑背景 · 雾紫强调', colors:['#17131f','#342841','#baa2ee'] },
  { id:'pearl', name:'月光白', description:'柔白背景 · 蓝灰层次', colors:['#f4f6fa','#dde5f0','#5378b5'] },
];
export function readTheme() { try { return localStorage.getItem('cms-ui-theme') || 'aurora'; } catch { return 'aurora'; } }
export function applyTheme(theme: string) { const id=themes.some(row=>row.id===theme)?theme:'aurora';document.documentElement.dataset.theme=id;try{localStorage.setItem('cms-ui-theme',id);}catch{} }
export function AppearanceSettings({ notify }: any) {
  const [theme,setTheme]=useState(document.documentElement.dataset.theme||readTheme()),[saving,setSaving]=useState(false);
  return <section className="settings-card appearance-settings"><div className="settings-card-title"><div><h3>界面风格</h3><p>三套完整配色，即时应用到全部页面与弹窗。</p></div></div><div className="theme-options">{themes.map(row=><button key={row.id} type="button" aria-pressed={theme===row.id} disabled={saving} className={`theme-option ${theme===row.id?'selected':''}`} onClick={async()=>{const previous=theme;applyTheme(row.id);setTheme(row.id);setSaving(true);try{await window.studio.call('appearance:set',{theme:row.id});}catch(error:any){applyTheme(previous);setTheme(previous);notify(error.message,true);}finally{setSaving(false);}}}><span className="theme-preview" style={{background:row.colors[0]}}><i style={{background:row.colors[1]}}/><b style={{background:row.colors[2]}}/><em style={{background:row.colors[2]}}/></span><strong>{row.name}{theme===row.id?' · 当前':''}</strong><small>{row.description}</small></button>)}</div></section>;
}
