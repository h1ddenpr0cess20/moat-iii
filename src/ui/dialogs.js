import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * Dialogs: a veil over the game with a panel on it. One is open at a time.
 * Each kind is a function that draws itself into a panel and, if the game
 * moves on while it is open, redraws when asked.
 */
export function createDialogs(ctx) {
  const kinds = new Map();
  let open = null;
  let veil = null;

  const dialogs = {
    register(name, make) { kinds.set(name, make); },
    get current() { return open?.name ?? null; },
    open(name, args = {}) {
      dialogs.close();
      ctx.tip.hide();
      const make = kinds.get(name);
      if (!make) return;
      const dialog = make(ctx, args);
      const title = h('h2', {}, dialog.title);
      const body = h('div.body');
      const tabs = dialog.tabs ? h('div.tabs') : null;
      const box = h('div.dialog.' + (dialog.parch === false ? 'panel' : 'parch'), { role: 'dialog', 'aria-label': dialog.title, style: dialog.width ? { width: `min(${dialog.width}px, calc(100vw - 20px))` } : {} },
        h('header', {}, dialog.icon ? h('span', { html: icon(dialog.icon, 28) }) : null, title, h('button.btn.small', { 'aria-label': 'Close', onclick: () => dialogs.close(), html: icon('close', 14) })),
        tabs, body);
      veil = h('div.veil', { onpointerdown: (e) => { if (e.target === veil) dialogs.close(); } }, box);
      document.getElementById('ui').append(veil);
      open = { name, dialog, body, tabs, title };
      dialog.draw(body, { tabs, title });
      ctx.sfx('open');
    },
    close() {
      if (!open) return;
      open.dialog.close?.();
      veil.remove();
      veil = null;
      open = null;
    },
    toggle(name, args) { if (open?.name === name) dialogs.close(); else dialogs.open(name, args); },
    /** Redraws what is open: call it when the week turns. */
    refresh() { if (open?.dialog.refresh) { const top = open.body.scrollTop; open.dialog.draw(open.body, open); open.body.scrollTop = top; } },
  };

  addEventListener('keydown', (e) => {
    if (!open || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
    if (e.code === 'Escape') { dialogs.close(); e.stopImmediatePropagation(); }
  }, true);
  return dialogs;
}
