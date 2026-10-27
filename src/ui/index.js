import { calendar } from '../sim/calendar.js';
import { HEARTS, blockAt } from '../sim/blocks.js';
import { idx } from '../world/world.js';
import { MONTHS } from '../config.js';
import { createDialogs } from './dialogs.js';
import { createTip, h } from './dom.js';
import { createHud } from './hud.js';
import { createInspector } from './inspector.js';
import { createLabels } from './labels.js';
import { ledgerDialog } from './ledger.js';
import { createMinimap } from './minimap.js';
import { realmDialog } from './realm.js';
import { menuDialog } from './menu.js';
import { createSteward } from './steward.js';
import { createToasts } from './toasts.js';
import { createToolbar } from './toolbar.js';
import { createTools } from './tools.js';
import './style.css';

/**
 * The interface, put together: the bar across the top, the dock below, the
 * panel on the right, the map in the corner, the messages, and the dialogs.
 * `ctx` is what they all share.
 */

function chronicle(ctx) {
  return {
    title: 'Island News',
    icon: 'scroll',
    refresh: true,
    draw(body) {
      const rows = ctx.game.log.map((e) => {
        const cal = calendar(e.week);
        return h('div.stat', { style: { cursor: e.at ? 'pointer' : 'default' }, onclick: () => { if (e.at) { ctx.dialogs.close(); ctx.scene.focusOn(e.at[0], e.at[1], { zoom: 0.8 }); } } },
          h('span', { class: e.kind === 'bad' ? 'bad' : e.kind === 'good' ? 'good' : '' }, e.text), h('span.dim', {}, `${MONTHS[cal.month]}, Year ${cal.year}`));
      });
      body.replaceChildren(...(rows.length ? rows : [h('p', {}, 'Nothing has happened yet.')]));
    },
  };
}

export function createUI({ game, scene, root, clock, sfx = () => {}, extra = {} }) {
  const tip = createTip(root);
  const ctx = { game, scene, tip, clock, sfx, hint: () => {}, say: () => {}, ...extra };
  ctx.dialogs = createDialogs(ctx);
  ctx.dialogs.register('ledger', ledgerDialog);
  ctx.dialogs.register('realm', realmDialog);
  ctx.dialogs.register('chronicle', chronicle);
  ctx.dialogs.register('menu', menuDialog);
  ctx.inspector = createInspector(ctx);
  ctx.describe = ctx.inspector.describe;
  ctx.tools = createTools(ctx);
  ctx.refreshPanels = () => { ctx.inspector.refresh(); ctx.dialogs.refresh(); };
  const toasts = createToasts(ctx);
  ctx.say = toasts.show;
  ctx.steward = createSteward(ctx);
  ctx.hint = (id, data) => {
    if (id === 'block') ctx.steward.hint('blockMade');
    else if (id === 'placed' && HEARTS[data?.type]) {
      const block = blockAt(game, data.x + 0.5, data.y + 0.5);
      if (block && block.core.includes(idx(Math.floor(data.x + data.w / 2), Math.floor(data.y + data.d / 2)))) ctx.steward.hint('heart');
    } else ctx.steward.hint(id);
  };
  const hud = createHud(ctx);
  const toolbar = createToolbar(ctx);
  const minimap = createMinimap(ctx);
  const labels = createLabels(ctx);
  root.append(labels.el, hud.el, toasts.el, ctx.steward.el, ctx.inspector.el, minimap.el, toolbar.options, toolbar.dock);

  game.on('note', ({ text, kind, at }) => {
    toasts.show(text, kind, at);
    // The news, if it is open, has the note at once rather than when the week turns.
    if (ctx.dialogs.current === 'chronicle') ctx.dialogs.refresh();
  });
  game.on('week', () => { ctx.dialogs.refresh(); ctx.steward.watch(); });

  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { clock.toggle(); e.preventDefault(); }
    else if (e.code === 'Tab') { clock.cycle(); e.preventDefault(); }
    else if (e.code === 'KeyM') ctx.dialogs.toggle('realm');
    else if (e.code === 'KeyL') ctx.dialogs.toggle('ledger');
    else if (e.code === 'KeyH') ctx.dialogs.toggle('chronicle');
    else if (e.code === 'KeyC') document.querySelector('.tool[aria-label="Tower"]')?.click();
    else if (e.code === 'F10') ctx.dialogs.toggle('menu');
  });

  let t = 0, slow = 0, mapT = 0, mapN = 0, hudFoot = -1, toastLift = -1;
  const ui = {
    ctx, tools: ctx.tools, hud, toasts, dialogs: ctx.dialogs, steward: ctx.steward, hide(on) { root.classList.toggle('away', on); },
    update(dt) {
      labels.update();
      t -= dt;
      mapT -= dt;
      if (t <= 0) {
        t = 0.25;
        hud.update();
        // The top bar wraps on a narrow screen: what hangs below it (the steward, the inspector) follows its foot.
        const foot = Math.round(hud.el.getBoundingClientRect().bottom);
        if (foot !== hudFoot) { hudFoot = foot; root.style.setProperty('--hud-bottom', `${foot}px`); }
        // The messages rise above whatever stands on the dock beneath them (the tool's choices, the panel as a sheet on a phone).
        const dock = toolbar.dock.getBoundingClientRect(), col = toasts.el.getBoundingClientRect();
        if (dock.height) {
          let top = dock.top;
          for (const el of [toolbar.options, ctx.inspector.el]) {
            if (el.hidden || !el.offsetParent) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom >= dock.top - 24 && r.left < col.right && r.right > col.left) top = Math.min(top, r.top);
          }
          const lift = Math.round(root.getBoundingClientRect().bottom - top);
          if (lift !== toastLift) { toastLift = lift; root.style.setProperty('--foot', `${lift}px`); }
        }
      }
      if (mapT <= 0) { mapT = 1; minimap.update(); if (++mapN % 5 === 0) minimap.repaint(); }
      slow -= dt;
      if (slow <= 0) { slow = 1.2; ctx.inspector.refresh(); toolbar.update(); }
    },
    repaintMap() { minimap.repaint(); },
  };
  hud.update();
  return ui;
}
