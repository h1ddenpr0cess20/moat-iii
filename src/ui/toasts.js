import { h } from './dom.js';
import { icon } from './icons.js';

const ICONS = { good: 'crown', bad: 'warning', warn: 'warning', info: 'scroll' };

/** The small messages that rise in the corner as things happen; a click goes to the place they are about. */
export function createToasts(ctx) {
  const el = h('div.toasts');
  const show = (text, kind = 'info', at = null) => {
    const t = h('div.toast', { class: kind, onclick: () => { if (at) ctx.scene.focusOn(at[0], at[1], { zoom: 0.8 }); t.remove(); } }, h('span', { html: icon(ICONS[kind] ?? 'scroll', 18) }), h('span', {}, text));
    el.prepend(t);
    while (el.children.length > 4) el.lastChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 600); }, kind === 'bad' ? 11000 : 7000);
  };
  return { el, show };
}
