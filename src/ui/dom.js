/**
 * A very small way of making elements: `h('div.card', { onclick }, 'text', child)`.
 * Classes follow the tag after dots; `html` sets innerHTML; `on*` props are listeners;
 * `style` takes an object; anything else is an attribute.
 */
export function h(spec, props = {}, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'class') el.classList.add(...String(v).split(' ').filter(Boolean));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}

export function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === undefined || k === null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** Replaces what is in `el` with `kids` (nothing, null and false are skipped). */
export const fill = (el, ...kids) => { clear(el); return add(el, kids); };

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

/** Whole numbers with thin separators: 12 400. */
export const num = (n, digits = 0) => {
  const v = Number(n) || 0;
  const s = Math.abs(v) >= 10000 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(digits);
  return digits ? s : s.replace(/\.0+$/, '');
};
export const round = (n) => Math.round(Number(n) || 0);
export const signed = (n, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

/** A tooltip that follows the pointer, for the whole page. */
export function createTip(root) {
  const el = h('div.tip', { role: 'tooltip' });
  root.append(el);
  el.hidden = true;
  const place = (x, y) => {
    const r = el.getBoundingClientRect();
    const px = Math.min(innerWidth - r.width - 8, Math.max(8, x + 18));
    const py = y + 22 + r.height > innerHeight - 8 ? y - r.height - 14 : y + 22;
    el.style.transform = `translate(${Math.round(px)}px, ${Math.round(Math.max(8, py))}px)`;
  };
  return {
    show(content, x, y) {
      clear(el);
      if (typeof content === 'string') el.innerHTML = content; else add(el, [content]);
      el.hidden = false;
      place(x, y);
    },
    hide() { el.hidden = true; },
    /** Gives `target` a tooltip made by `fn()` when the pointer rests on it. */
    attach(target, fn) {
      // A phone has nothing that rests on a thing; the mouse events it makes up after a tap would leave a tip standing over the screen.
      if (globalThis.matchMedia && !globalThis.matchMedia('(hover: hover)').matches) return target;
      target.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { const c = fn(); if (c) this.show(c, e.clientX, e.clientY); } });
      target.addEventListener('pointermove', (e) => { if (!el.hidden) { const c = fn(); if (c) { this.show(c, e.clientX, e.clientY); } } });
      target.addEventListener('pointerleave', () => this.hide());
      target.addEventListener('pointerdown', () => this.hide());
      return target;
    },
  };
}
