/**
 * How this page was opened. A new realm or a load reloads the page, and what
 * the title chose (seed, size, raiders) is handed to the next page in the
 * session, not the address: the address stays plain, and a reload after goes
 * on with the game in play rather than starting the same new realm again.
 * The address may still give any of them (handy in development); they are
 * read once and taken out of it.
 */

const KEY = 'moat3.launch.v1';
/** What the address may carry that is about which game, not how to look at it. */
const GAME = ['new', 'load', 'play', 'seed', 'difficulty', 'size', 'disasters'];

function read() {
  if (typeof location === 'undefined') return new URLSearchParams();
  const out = new URLSearchParams(location.search);
  try {
    const handed = sessionStorage.getItem(KEY);
    if (handed) {
      sessionStorage.removeItem(KEY);
      for (const [k, v] of Object.entries(JSON.parse(handed))) out.set(k, String(v));
    }
  } catch { /* no session storage: the address is all there is */ }
  const left = new URLSearchParams(location.search);
  if (GAME.some((k) => left.has(k))) {
    for (const k of GAME) left.delete(k);
    const q = left.toString();
    try { history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`); } catch { /* the address stays as it is */ }
  }
  return out;
}

/** This page's options: the address's, and over them what the last page handed on. */
export const params = read();

/** Opens the game again with `opts` (e.g. `{ load: 1 }`, or a new realm's choices). */
export function relaunch(opts) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(opts));
  } catch {
    // No session storage: the address must carry them.
    location.search = `?${new URLSearchParams(opts)}`;
    return;
  }
  // Without a fragment, so it is a new page and not a jump within this one.
  location.replace(`${location.pathname}${location.search}`);
}
