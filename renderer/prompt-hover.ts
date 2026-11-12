export function promptSegments(text: string) {
  const result: { start: number; end: number; text: string }[] = [];
  let start = 0, escaped = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (i === text.length || (!escaped && /[,，\n]/.test(char))) {
      if (text.slice(start, i).trim()) result.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
    if (char === '\\' && !escaped) escaped = true; else escaped = false;
  }
  return result;
}

// Native textarea contents cannot be hit-tested with DOM Range. Measure an
// invisible text copy with identical typography, then account for its scroll.
export function createPromptHitTest(textarea: HTMLTextAreaElement) {
  const style = getComputedStyle(textarea), mirror = document.createElement('div');
  mirror.className = 'prompt-translation-mirror'; mirror.setAttribute('aria-hidden', 'true');
  Object.assign(mirror.style, { position: 'fixed', left: '-100000px', top: '0', width: `${textarea.clientWidth}px`, boxSizing: 'border-box', height: 'auto', minHeight: '0', margin: '0', border: '0', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  for (const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant','fontKerning','letterSpacing','wordSpacing','lineHeight','textAlign','textIndent','textTransform','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak','direction'] as const) mirror.style[property] = style[property];
  const segments = promptSegments(textarea.value), elements: { element: HTMLSpanElement; segment: typeof segments[number] }[] = [];
  let offset = 0;
  for (const segment of segments) { mirror.append(document.createTextNode(textarea.value.slice(offset, segment.start))); const element = document.createElement('span'); element.textContent = segment.text; mirror.append(element); elements.push({ element, segment }); offset = segment.end; }
  mirror.append(document.createTextNode(textarea.value.slice(offset))); document.body.append(mirror);
  const origin = mirror.getBoundingClientRect();
  const boxes = elements.flatMap(({ element, segment }) => [...element.getClientRects()].map(rect => ({ segment, left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top })));
  const width = textarea.clientWidth, value = textarea.value;
  return {
    valid: () => textarea.clientWidth === width && textarea.value === value,
    hit: (clientX: number, clientY: number) => {
      const rect = textarea.getBoundingClientRect();
      const x = clientX - rect.left - parseFloat(style.borderLeftWidth) + textarea.scrollLeft;
      const y = clientY - rect.top - parseFloat(style.borderTopWidth) + textarea.scrollTop;
      return boxes.find(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)?.segment;
    },
    remove: () => mirror.remove(),
  };
}

export function promptCaretPoint(textarea: HTMLTextAreaElement, offset: number) {
  const style = getComputedStyle(textarea), mirror = document.createElement('div');
  Object.assign(mirror.style, { position: 'fixed', left: '-100000px', top: '0', width: `${textarea.clientWidth}px`, boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', visibility: 'hidden', pointerEvents: 'none', border: '0', margin: '0' });
  for (const property of ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','wordSpacing','lineHeight','textAlign','textIndent','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak'] as const) mirror.style[property] = style[property];
  mirror.append(document.createTextNode(textarea.value.slice(0, offset)));
  const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker, document.createTextNode(textarea.value.slice(offset))); document.body.append(mirror);
  const bounds = textarea.getBoundingClientRect(), origin = mirror.getBoundingClientRect(), caret = marker.getBoundingClientRect();
  const point = { x: bounds.left + parseFloat(style.borderLeftWidth) + caret.left - origin.left - textarea.scrollLeft, y: bounds.top + parseFloat(style.borderTopWidth) + caret.bottom - origin.top - textarea.scrollTop };
  mirror.remove(); return point;
}
