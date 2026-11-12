export function loraDefault(model: Record<string, any>) {
  const value = Number(model.recommendedStrength?.value);
  const strength = model.recommendedStrength && Number.isFinite(value) && value >= 0 && value <= 3 ? value : 1;
  return { modelId: model.id, strengthModel: strength, strengthClip: strength };
}
