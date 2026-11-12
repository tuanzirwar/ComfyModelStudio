import { Select } from './Select';
import './checkpoint-picker.css';
type Model = { id: string; type?: string; missing?: boolean; name?: string; filename?: string; versionName?: string; baseModel?: string; baseModels?: string[]; baseTargets?: string[] };
export function checkpointTitle(model: Model) {
  const name = model.name || model.filename || '未命名模型', version = (model.versionName || '').trim();
  if (!version || name.toLowerCase().includes(version.toLowerCase())) return name;
  const number = version.match(/\bv(\d+(?:\.\d+)?)/i)?.[1];
  if (number && new RegExp(`v${number.replaceAll('.', '\\.')}\\b`, 'i').test(name) && !/turbo|aesthetic|base/i.test(version)) return name;
  return `${name} · ${version.replace(/^(turbo|aesthetic|base)-/i, (_, part: string) => `${part[0].toUpperCase()}${part.slice(1)} `)}`;
}
export function CheckpointPicker({ models, value, onChange }: { models: Model[]; value: string; onChange: (id: string) => void }) {
  const selected = models.find(m => m.id === value);
  const choices = models.filter(m => m.type === 'Checkpoint' && !m.missing);
  return <div className="checkpoint-picker"><Select triggerClassName="checkpoint-picker-toggle" menuClassName="checkpoint-select-menu" aria-label="选择基础模型" value={value} onChange={event => onChange(event.target.value)}>
    {!selected && <option value="" disabled>请选择 Checkpoint</option>}
    {selected?.missing && <option value={value} disabled>{selected.name || selected.filename} · 文件缺失</option>}
    {choices.map(model => <option value={model.id} key={model.id} data-description={[model.baseModel || '未知基模', ...(choices.filter(other => checkpointTitle(other) === checkpointTitle(model)).length > 1 ? [model.filename] : [])].filter(Boolean).join(' · ')} data-search={[model.filename, ...(model.baseModels || []), ...(model.baseTargets || [])].filter(Boolean).join(' ')}>{checkpointTitle(model)}</option>)}
  </Select></div>;
}
