import { h } from './dom.js';
import { icon } from './icons.js';

const ICONS = { good: 'crown', bad: 'warning', warn: 'warning', info: 'scroll' };

/** The small messages that rise in the corner as things happen; a click goes to the place they are about. */
export function createToasts(ctx) {
  const el = h('div.toasts');
  const live = new Map();
  const drop = (t) => { if (live.get(t.key) === t) live.delete(t.key); t.el.remove(); };
  const linger = (t) => {
    clearTimeout(t.timer);
    t.el.classList.remove('out');
    t.timer = setTimeout(() => { t.el.classList.add('out'); t.timer = setTimeout(() => drop(t), 600); }, t.kind === 'bad' ? 11000 : 7000);
  };
  const show = (text, kind = 'info', at = null) => {
    // A quiet note goes in the news but not in the corner.
    if (kind === 'quiet') return;
    // The same message again does not stack: the one showing counts it and stays a while longer.
    const key = `${kind}|${text}`;
    let t = live.get(key);
    if (t) {
      t.n++;
      t.count.textContent = ` ×${t.n}`;
      t.at = at ?? t.at;
    } else {
      t = { key, kind, at, n: 1, count: h('span.count') };
      t.el = h('div.toast', { class: kind, onclick: () => { if (t.at) ctx.scene.focusOn(t.at[0], t.at[1], { zoom: 0.8 }); clearTimeout(t.timer); drop(t); } },
        h('span', { html: icon(ICONS[kind] ?? 'scroll', 18) }), h('span', {}, text, t.count));
      live.set(key, t);
    }
    el.prepend(t.el);
    linger(t);
    while (el.children.length > 4) {
      const last = [...live.values()].find((o) => o.el === el.lastChild);
      if (last) { clearTimeout(last.timer); drop(last); } else el.lastChild.remove();
    }
  };
  return { el, show };
}
