import type { CSSProperties } from 'react';
import './secondary-category-filter.css';

export function SecondaryCategoryFilter({ categories, value, onChange }: { categories: string[]; value: string; onChange: (value: string) => void }) {
  const labels = [...new Set(categories)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const items = [{ value: 'all', label: '全部' }, { value: 'none', label: '未分类' }, ...labels.map(label => ({ value: `tag:${label}`, label }))];
  return <div className="secondary-category-filter"><div className="secondary-category-buttons" role="group" aria-label="LoRA 选择器二级分类" style={{ '--category-count': items.length, '--category-characters': items.reduce((sum, item) => sum + [...item.label].length, 0) } as CSSProperties}>
    {items.map(item => <button key={item.value} type="button" title={item.label} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div></div>;
}
