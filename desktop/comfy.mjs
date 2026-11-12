export function comfyAddress(value = 'http://127.0.0.1:8188') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('ComfyUI 地址必须是本机 localhost / 127.0.0.1 的 HTTP(S) 地址');
  return url.origin;
}
export class ComfyClient {
  constructor({ address = 'http://127.0.0.1:8188', fetcher = fetch, socketFactory = url => new WebSocket(url) } = {}) { this.address = comfyAddress(address); this.fetcher = fetcher; this.socketFactory = socketFactory; }
  async request(route, body, timeout = 15000) {
    let response;
    try { response = await this.fetcher(this.address + route, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) }); }
    catch (cause) { throw new Error(`无法连接 ComfyUI（${this.address}）：${cause.message}`); }
    const text = await response.text(); let data;
    try { data = text ? JSON.parse(text) : {}; if (typeof data === 'string') data = JSON.parse(data); } catch { throw new Error(`ComfyUI 返回非 JSON 内容（HTTP ${response.status}）`); }
    if (!response.ok) { const nodeErrors = Object.entries(data.node_errors || {}).flatMap(([id, error]) => (error.errors || []).map(e => `节点 ${id}: ${e.message}${e.details ? ` · ${e.details}` : ''}`)); const error = new Error(nodeErrors.join('\n') || data.error?.message || data.error || `ComfyUI HTTP ${response.status}`); error.details = data; error.httpStatus = response.status; throw error; }
    return data;
  }
  async probe() {
    const [stats, info, queue] = await Promise.all([this.request('/system_stats'), this.request('/object_info', undefined, 30000), this.request('/queue')]);
    return { stats, info, queue, address: this.address };
  }
  submit(prompt, promptId, clientId, workflow) { return this.request('/prompt', { prompt, prompt_id: promptId, client_id: clientId, extra_data: { extra_pnginfo: { workflow }, studio: true } }, 60000); }
  async history(promptId) { return (await this.request(`/history/${encodeURIComponent(promptId)}`))[promptId] || null; }
  queue() { return this.request('/queue'); }
  deletePending(promptId) { return this.request('/queue', { delete: [promptId] }); }
  interrupt(promptId) { if (!promptId) throw new Error('禁止全局中断'); return this.request('/interrupt', { prompt_id: promptId }); }
  imageURL(image) { const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' }); return `${this.address}/view?${query}`; }
  watch(clientId, onEvent, onState = () => {}) {
    let socket; let stopped = false; let retry;
    const connect = () => {
      if (stopped) return;
      try {
        const url = new URL(this.address); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = '/ws'; url.searchParams.set('clientId', clientId); socket = this.socketFactory(url.href);
        socket.addEventListener('open', () => onState('connected'));
        socket.addEventListener('message', event => { if (typeof event.data !== 'string') return; try { onEvent(JSON.parse(event.data)); } catch {} });
        socket.addEventListener('error', () => onState('disconnected'));
        socket.addEventListener('close', () => { onState('disconnected'); if (!stopped) retry = setTimeout(connect, 2500); });
      } catch { onState('disconnected'); retry = setTimeout(connect, 2500); }
    };
    connect(); return () => { stopped = true; clearTimeout(retry); socket?.close(); };
  }
}

export function historyState(history) {
  if (!history) return null;
  const status = history.status || {};
  const error = (status.messages || []).findLast?.(message => ['execution_error', 'execution_interrupted'].includes(message[0]));
  if (status.status_str === 'error' || error) return { state: error?.[0] === 'execution_interrupted' ? 'canceled' : 'failed', error: error?.[1]?.exception_message || error?.[1]?.message || 'ComfyUI 执行失败', nodeId: error?.[1]?.node_id };
  if (status.completed || status.status_str === 'success') {
    const images = [];
    for (const [nodeId, output] of Object.entries(history.outputs || {})) for (const image of output.images || []) if (image.filename && ['output', 'temp'].includes(image.type || 'output')) images.push({ ...image, nodeId });
    return { state: 'succeeded', images };
  }
  return { state: 'running' };
}
