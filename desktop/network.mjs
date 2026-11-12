// Electron net.fetch rejects manual redirects instead of returning a 3xx.
// Adapt net.request so Civitai can inspect every hop before sending credentials.
export function normalizeResponseHeaders(input, baseURL) {
  const out = new Headers();
  for (const [key, value] of Object.entries(input || {})) for (const part of Array.isArray(value) ? value : [value]) {
    let text = String(part);
    if (key.toLowerCase() === 'location') text = new URL(text, baseURL).href;
    // Electron may expose decoded Unicode; Fetch Headers requires byte strings.
    // Preserve its UTF-8 bytes, including legacy Content-Disposition filenames.
    else if (/[^\u0000-\u00ff]/.test(text)) text = Buffer.from(text, 'utf8').toString('latin1');
    out.append(key, text);
  }
  return out;
}

export function electronFetch(net) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    // Electron's credentials:'omit' strips an explicitly supplied Authorization
    // header too. Keep a separate in-memory session and disable cookies instead.
    const request = net.request({ url: String(url), method: options.method || 'GET', redirect: 'manual', partition: 'cms-download-network', useSessionCookies: false });
    let settled = false, controller, ended = false;
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const fail = error => { if (ended) return; ended = true; cleanup(); if (!settled) { settled = true; reject(error); } if (controller) controller.error(error); };
    const failRequest = error => { fail(error); request.abort(); };
    const abort = () => { fail(options.signal.reason || new DOMException('已取消', 'AbortError')); request.abort(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    request.setHeader('User-Agent', 'ComfyModelStudio/0.4');
    for (const [name, value] of new Headers(options.headers)) request.setHeader(name, value);
    request.on('redirect', (status, _method, location, responseHeaders) => {
      if (settled) return;
      try {
        const out = normalizeResponseHeaders(responseHeaders, String(url)); out.set('location', new URL(location, String(url)).href);
        const response = new Response(null, { status, headers: out });
        settled = true; ended = true; cleanup(); resolve(response);
      } catch (error) { failRequest(error); }
      // Deliberately do not call followRedirect. The caller validates the target.
    });
    request.on('error', fail);
    request.on('response', response => {
      if (settled) return;
      try {
      const bodyless = options.method === 'HEAD' || [204, 205, 304].includes(response.statusCode);
      const body = bodyless ? null : new ReadableStream({
        start(value) { controller = value; },
        cancel() { if (!ended) { ended = true; cleanup(); request.abort(); } }
      });
      response.on('data', chunk => { if (!ended && controller) controller.enqueue(new Uint8Array(chunk)); });
      response.on('end', () => { if (!ended) { ended = true; cleanup(); controller?.close(); } });
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('下载连接中断，可重试续传')));
      const result = new Response(body, { status: response.statusCode, headers: normalizeResponseHeaders(response.headers, String(url)) });
      settled = true; resolve(result);
      } catch (error) { failRequest(error); }
    });
    request.end(options.body);
  });
}

