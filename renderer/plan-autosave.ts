type Plan = Record<string, any>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = 'modelstudio.plan.pending';

// This controller outlives the page; navigation cannot cancel database writes.
export class PlanAutosaver {
  private latest: Plan | null = null;
  private version = 0;
  private saved = 0;
  private running = false;
  private work: Promise<void> | null = null;
  private acknowledged: Plan | null = null;
  private listeners = new Set<() => void>();
  private save: (plan: Plan) => Promise<unknown>;
  private storage?: Storage;
  status: 'saved' | 'saving' | 'error' = 'saved';
  error = '';
  constructor(save: (plan: Plan) => Promise<unknown>, storage?: Storage) {
    this.save = save; this.storage = storage;
    try {
      const draft = JSON.parse(storage?.getItem(key) || 'null');
      if (draft && Array.isArray(draft.items)) { this.latest = draft; this.version = 1; this.status = 'saving'; }
    } catch { /* Database saves work even when browser caching is unavailable. */ }
  }
  pending() { return this.version > this.saved && this.latest ? structuredClone(this.latest) : null; }
  initial(fallback: Plan) {
    return this.pending() || structuredClone(this.acknowledged && String(this.acknowledged.updatedAt || '') > String(fallback.updatedAt || '') ? this.acknowledged : fallback);
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const fn of this.listeners) fn(); }
  edit(plan: Plan) {
    this.latest = structuredClone(plan); this.version++;
    try { this.storage?.setItem(key, JSON.stringify(this.latest)); } catch { /* Database is the primary copy. */ }
    this.status = 'saving'; this.error = ''; this.emit(); void this.flush();
  }
  flush(): Promise<void> {
    if (this.running) return this.work || Promise.resolve();
    if (!this.latest || this.saved === this.version) return Promise.resolve();
    this.work = this.persistLatest(); return this.work;
  }
  private async persistLatest() {
    this.running = true; this.status = 'saving'; this.error = ''; this.emit();
    try {
      while (this.saved < this.version) {
        const revision = this.version, value = structuredClone(this.latest!);
        try {
          const result = await this.save(value);
          this.acknowledged = result && typeof result === 'object' && Array.isArray((result as Plan).items) ? structuredClone(result as Plan) : { ...value, updatedAt: new Date().toISOString() };
        }
        catch (error: any) {
          if (revision < this.version) continue;
          this.status = 'error'; this.error = error.message || '保存失败'; return;
        }
        this.saved = revision;
      }
      try { this.storage?.removeItem(key); } catch { /* Best effort cleanup. */ }
      this.status = 'saved';
    } finally { this.running = false; this.emit(); }
  }
}
