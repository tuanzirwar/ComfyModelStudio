export function versionReference(model) {
  const { origin, modelId, versionId, fileId, versionName, baseModel, baseTargets, sourceUrl, recommendedStrength } = model;
  return { origin, modelId, versionId, fileId, versionName, baseModel, baseTargets: baseTargets || [], sourceUrl, recommendedStrength };
}
export function mergeVersionReferences(prior, next) {
  return [...new Map([...(prior.sourceVersions || []),versionReference(prior),versionReference(next)].filter(v => v.modelId && v.versionId && v.fileId).map(v => [`${v.origin}:${v.versionId}:${v.fileId}`,v])).values()];
}
export function modelHasVersion(model, modelId, versionId, fileId) {
  return [model, ...(model.sourceVersions || [])].some(v => v.modelId === modelId && v.versionId === versionId && (!fileId || v.fileId === fileId));
}
