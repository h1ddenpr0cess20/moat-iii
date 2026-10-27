/**
 * Giving geometry back. The engine makes a graphics-card buffer for each
 * attribute of a geometry the first time it is drawn, and `dispose()` does
 * not delete them: they wait for the garbage collector, and a town that
 * redraws a chunk whenever something is built leaves hundreds of megabytes
 * waiting. This deletes them at once. It reaches into the backend's own table
 * of buffers, so it checks as it goes, and does nothing it does not understand.
 */

let backend = null;

/** Tells it which renderer the buffers belong to. */
export function useRenderer(renderer) { backend = renderer?.backend ?? null; }

/** Frees what the graphics card holds for each of `attributes`. */
function freeAttributes(attributes) {
  const table = backend?.buffers;
  if (!table?.get || !table.delete) return;
  for (const attribute of attributes) {
    if (!attribute) continue;
    const entry = table.get(attribute);
    if (!entry) continue;
    try {
      if (typeof entry.buffer?.destroy === 'function') entry.buffer.destroy();
      else backend.gl?.deleteBuffer?.(entry.buffer);
    } catch (err) {
      console.warn('moat: a buffer could not be freed', err);
    }
    table.delete(attribute);
  }
}

/** Frees what the graphics card holds for `geometry`, and the geometry itself. */
export function freeGeometry(geometry) {
  if (!geometry) return;
  freeAttributes([...Object.values(geometry.attributes ?? {}), geometry.index]);
  geometry.dispose?.();
}

/** Frees the geometry of every mesh in `object` and below. */
export function freeTree(object) {
  object.traverse((o) => { if (o.geometry) freeGeometry(o.geometry); });
}

/** Frees the copies of every instanced mesh in `object` and below, leaving the geometry they share alone. */
export function freeInstances(object) {
  object.traverse((o) => { if (o.isInstancedMesh) freeAttributes([o.instancePlace, o.instanceLook]); });
}
