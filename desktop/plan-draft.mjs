// Allow incomplete editing values. Execution still validates every task.
export function savePlanDraft(store, input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items) || input.items.length > 500) throw new Error('编排草稿格式无效，最多支持 500 项');
  if (JSON.stringify(input).length > 8 * 1024 * 1024) throw new Error('编排草稿过大');
  const draft = structuredClone(input);
  draft.updatedAt = new Date().toISOString();
  store.set('plan', draft);
  return draft;
}
