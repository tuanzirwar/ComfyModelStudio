import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Layers3 } from 'lucide-react';
import './sidebar-sections.css';

export function SidebarSections({ workspace, bases, baseCount, selectedBase }: { workspace: ReactNode; bases: ReactNode; baseCount: number; selectedBase: string }) {
  const [active, setActive] = useState<'workspace' | 'bases'>(() => { try { return localStorage.getItem('cms-sidebar-section') === 'bases' ? 'bases' : 'workspace'; } catch { return 'workspace'; } });
  const select = (value: 'workspace' | 'bases') => { setActive(value); try { localStorage.setItem('cms-sidebar-section', value); } catch {} };
  return <div className="sidebar-sections">
    <section className={`sidebar-section sidebar-section-workspace ${active === 'workspace' ? 'is-expanded' : 'is-compact'}`}>
      <button type="button" className="sidebar-section-toggle" aria-expanded={active === 'workspace'} aria-controls="sidebar-workspace" onClick={() => select(active === 'workspace' ? 'bases' : 'workspace')}><span>工作空间</span><ChevronDown size={14}/></button>
      <div id="sidebar-workspace" className="sidebar-section-content" onClickCapture={event => { if ((event.target as HTMLElement).closest('button.nav-item')) select('workspace'); }}>{workspace}</div>
    </section>
    <section className={`sidebar-section sidebar-section-bases ${active === 'bases' ? 'is-expanded' : 'is-compact'}`}>
      <button type="button" className="sidebar-section-toggle" aria-expanded={active === 'bases'} aria-controls="sidebar-bases" onClick={() => select(active === 'bases' ? 'workspace' : 'bases')}><span>基础模型</span><small>{baseCount} 系列</small><ChevronDown size={14}/></button>
      <div id="sidebar-bases" className="sidebar-section-content" hidden={active !== 'bases'}>{bases}</div>
      {active !== 'bases' && <button type="button" className="sidebar-base-summary" title={selectedBase} aria-label={`展开基模筛选，当前${selectedBase}`} onClick={() => select('bases')}><Layers3 size={13}/><span>{selectedBase}</span><ChevronDown size={12}/></button>}
    </section>
  </div>;
}
