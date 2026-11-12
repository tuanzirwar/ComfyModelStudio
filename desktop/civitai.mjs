import { plainHtml } from './utils.mjs';
import { baseTargets, recommendedStrength, WAI } from './version-catalog.mjs';

export function sourceOrigin(value) { const url = new URL(value); if (!['https://civitai.red', 'https://civitai.com'].includes(url.origin)) throw new Error('仅支持 civitai.red 或 civitai.com 的 HTTPS 地址'); return url.origin; }
export function previewAllowed(value) { try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'image.civitai.com' || u.hostname === 'blobs-b2.civitai.com' || u.hostname.endsWith('.civitai.com')); } catch { return false; } }
export function remoteAllowed(value, origin) { const u = new URL(value); return u.protocol === 'https:' && (u.origin === sourceOrigin(origin) || previewAllowed(value) || u.hostname.endsWith('.cloudflarestorage.com')); }
export class Civitai {
  constructor({ fetcher = fetch, token = () => '' } = {}) { this.fetch = fetcher; this.token = token; }
  async request(url, { origin, signal, headers = {}, method = 'GET', auth = true, image = false } = {}) {
    origin = sourceOrigin(origin || new URL(url).origin);
    for (let hop = 0; hop < 6; hop++) {
      if (!(image ? previewAllowed(url) : remoteAllowed(url, origin))) throw new Error('下载地址不在允许的来源或 CDN 中');
      const nextHeaders = { ...headers };
      const token = this.token(origin);
      if (auth && token && new URL(url).origin === origin) nextHeaders.Authorization = `Bearer ${token}`;
      let response;
      try { response = await this.fetch(url, { method, headers: nextHeaders, signal, redirect: 'manual', credentials: 'omit' }); }
      catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        const code = error.cause?.code || error.message?.match(/net::[A-Z_]+/)?.[0] || error.name;
        throw new Error(`无法连接 ${new URL(url).hostname}${code ? `（${code}）` : ''}，请检查网络或系统代理`, { cause: error });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('下载跳转缺少地址');
        url = new URL(location, url).href; continue;
      }
      if (!response.ok && response.status !== 416) {
        await response.body?.cancel();
        if (response.status === 401) throw new Error(new URL(url).origin !== origin ? '下载链接已失效，请重试以获取新的授权链接' : token ? '站点拒绝了已配置的 API Key，或当前账户无权下载此文件；请核对密钥、来源和资源权限' : `尚未为 ${new URL(origin).hostname} 配置可用 API Key，请在设置中保存密钥`);
        if (response.status === 403) throw new Error('网站拒绝访问：请检查资源权限、登录或网络代理');
        if (response.status === 429) throw new Error(`请求过于频繁，请稍后重试${response.headers.get('retry-after') ? `（${response.headers.get('retry-after')} 秒）` : ''}`);
        throw new Error(`网站返回 HTTP ${response.status}`);
      }
      return response;
    }
    throw new Error('下载跳转次数过多');
  }
  async json(url, origin, signal) { const response = await this.request(url, { origin, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); if (Number(response.headers.get('content-length')) > 15_000_000) throw new Error('模型资料响应过大'); return response.json(); }
  async resolve(input, { signal } = {}) {
    let origin = sourceOrigin(input.origin || input.url || 'https://civitai.red');
    let versionId = Number(input.versionId);
    let modelId = Number(input.modelId);
    if (input.url) {
      const u = new URL(input.url); origin = sourceOrigin(u.origin);
      modelId = Number(u.pathname.match(/\/models\/(\d+)/)?.[1]) || modelId;
      versionId = Number(u.searchParams.get('modelVersionId')) || versionId;
    }
    let model, version;
    if (versionId) { version = await this.json(`${origin}/api/v1/model-versions/${versionId}`, origin, signal); modelId = version.modelId; }
    if (!modelId) throw new Error('请输入模型链接，或包含版本 ID 的链接');
    model = await this.json(`${origin}/api/v1/models/${modelId}`, origin, signal);
    if (!version) {
      const first = model.modelVersions?.[0];
      if (!first) throw new Error('该模型没有可下载版本');
      version = await this.json(`${origin}/api/v1/model-versions/${first.id}`, origin, signal);
    }
    if (version.modelId !== model.id) throw new Error('模型与版本不匹配，请重新采集');
    const files = (version.files || []).filter(file => ['Model', 'Pruned Model'].includes(file.type) && file.downloadUrl);
    if (!files.length) throw new Error('该版本没有公开可下载模型文件');
    const images = (version.images || []).filter(image => image.type === 'image' && previewAllowed(image.url));
    return { origin, model, version, files, images, descriptionText: plainHtml(model.description || '') };
  }
  async byHash(hash, origin) { origin = sourceOrigin(origin); const version = await this.json(`${origin}/api/v1/model-versions/by-hash/${hash}`, origin); return this.resolve({ origin, versionId: version.id }); }
}
export function normalizedMetadata(bundle, file) {
  const { model, version, origin } = bundle;
  return { baseTargets: baseTargets(model, version), recommendedStrength: recommendedStrength(model, version), sourceName: model.name, name: Number(model.id) === 827184 ? `${WAI} ${version.name}` : model.name, versionName: version.name, modelId: model.id, versionId: version.id, fileId: file.id, origin, sourceUrl: `${origin}/models/${model.id}?modelVersionId=${version.id}`, type: model.type, baseModel: version.baseModel || '未知基模', triggerWords: version.trainedWords || [], description: model.description || '', versionDescription: version.description || '', creator: model.creator?.username || '', tags: model.tags || [], sha256: file.hashes?.SHA256 || '', hashes: file.hashes || {}, publishedAt: version.publishedAt, air: version.air, stats: version.stats || model.stats, fileMetadata: file.metadata, collectedAt: new Date().toISOString() };
}
