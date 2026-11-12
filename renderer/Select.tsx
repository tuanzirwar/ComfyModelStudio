import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import './select.css';

type Choice = { value: string; label: string; description: string; disabled: boolean; search: string };
type Props = { children: ReactNode; value?: string | number; onChange: (event: { target: { value: string } }) => void; className?: string; triggerClassName?: string; menuClassName?: string; disabled?: boolean; id?: string; 'aria-label'?: string };
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('');
}
function choicesFrom(children: ReactNode, inheritedDisabled = false): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; 'data-description'?: string; 'data-search'?: string }>(child)) return [];
    const p = child.props;
    if (child.type !== 'option') return choicesFrom(p.children, inheritedDisabled || !!p.disabled);
    const label = text(p.children), description = p['data-description'] || '';
    return [{ value: String(p.value ?? label), label, description, disabled: inheritedDisabled || !!p.disabled, search: `${label} ${description} ${p['data-search'] || ''}`.toLocaleLowerCase() }];
  });
}

// Render menus inside the page rather than relying on Electron's native popup.
// A body portal escapes scroll containers, modal clipping and inspector stacking.
export function Select({ children, value = '', onChange, className = '', triggerClassName = '', menuClassName = '', disabled = false, id, 'aria-label': ariaLabel }: Props) {
  const options = choicesFrom(children), selected = options.find(option => option.value === String(value));
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState('');
  const [placement, setPlacement] = useState({ top: 0, left: 8, width: 240, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const listId = useId(), visible = options.filter(option => option.search.includes(query.toLocaleLowerCase()));
  const enabled = visible.filter(option => !option.disabled), searchable = options.length > 7;
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = (edge?: 'first' | 'last') => {
    if (disabled) return;
    setQuery(''); setActive(!edge && selected && !selected.disabled ? selected.value : (edge === 'last' ? options.filter(o => !o.disabled).at(-1)?.value : options.find(o => !o.disabled)?.value) ?? ''); setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const r = trigger.current?.getBoundingClientRect(); if (!r) return;
      const height = window.innerHeight, width = window.innerWidth;
      if (r.bottom < 0 || r.top > height) { setOpen(false); return; }
      const below = height - r.bottom - 14, above = r.top - 14;
      const up = below < 220 && above > below;
      const maxHeight = Math.max(60, Math.min(360, up ? above : below, height - 16));
      const menuWidth = Math.min(Math.max(r.width, 220), width - 16);
      const actualHeight = Math.min(menu.current?.scrollHeight || maxHeight, maxHeight);
      setPlacement({ top: up ? Math.max(8, r.top - 6 - actualHeight) : Math.max(8, r.bottom + 6), left: Math.max(8, Math.min(r.left, width - menuWidth - 8)), width: menuWidth, maxHeight });
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open, query, options.length]);
  useEffect(() => {
    if (!open) return;
    (searchable ? search.current : menu.current?.querySelector<HTMLElement>('[role=listbox]'))?.focus();
    const outside = (event: Event) => { const node = event.target as Node; if (!menu.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open, searchable]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { menu.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  const choose = (option: Choice) => { if (option.disabled) return; onChange({ target: { value: option.value } }); close(true); };
  return <div className={`studio-select ${className}`}>
    <button ref={trigger} id={id} type="button" className={`studio-select-trigger ${triggerClassName}`} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={event => { event.stopPropagation(); if (open) close(); else show(); }} onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); show(event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : undefined); }
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    }} title={selected?.label}><span>{selected?.label || '请选择…'}</span><ChevronDown size={16}/></button>
    {open && createPortal(<div ref={menu} className={`studio-select-menu ${menuClassName}`} style={placement} tabIndex={-1} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') { close(true); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = enabled.findIndex(option => option.value === active);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : event.key === 'ArrowDown' ? (index + 1) % enabled.length : (index < 0 ? enabled.length - 1 : index - 1 + enabled.length) % enabled.length;
        if (enabled[next]) setActive(enabled[next].value);
      }
      if (event.key === 'Enter' || (event.key === ' ' && event.target !== search.current)) { event.preventDefault(); event.stopPropagation(); const option = enabled.find(option => option.value === active); if (option) choose(option); }
    }}>
      {searchable && <div className="studio-select-search"><Search size={15}/><input ref={search} role="combobox" aria-expanded="true" aria-label={`搜索${ariaLabel || '选项'}`} placeholder="输入关键词筛选…" value={query} aria-controls={listId} aria-activedescendant={enabled.some(o => o.value === active) ? `${listId}-${options.findIndex(o => o.value === active)}` : undefined} onChange={event => { setQuery(event.target.value); setActive(options.find(option => !option.disabled && option.search.includes(event.target.value.toLocaleLowerCase()))?.value ?? ''); }}/></div>}
      <div id={listId} className="studio-select-options" role="listbox" tabIndex={-1} aria-label={ariaLabel || '可用选项'} aria-activedescendant={`${listId}-${options.findIndex(o => o.value === active)}`}>
        {visible.map(option => <button key={option.value} id={`${listId}-${options.indexOf(option)}`} type="button" tabIndex={-1} role="option" aria-selected={String(value) === option.value} aria-disabled={option.disabled} disabled={option.disabled} data-active={active === option.value} onMouseEnter={() => { if (!option.disabled) setActive(option.value); }} onClick={() => choose(option)}><span>{option.label}{option.description && <small>{option.description}</small>}</span>{String(value) === option.value && <Check size={16}/>}</button>)}
        {!visible.length && <p role="status">没有匹配的选项</p>}
      </div>
    </div>, document.body)}
  </div>;
}
