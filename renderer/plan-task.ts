export function patchPlanTask(plan: Record<string, any>, id: string, patch: Record<string, any>) {
  return { ...plan, items: plan.items.map((item: Record<string, any>) => item.id === id ? { ...item, ...patch, ...(patch.overrides ? { overrides: { ...item.overrides, ...patch.overrides } } : {}) } : item) };
}
