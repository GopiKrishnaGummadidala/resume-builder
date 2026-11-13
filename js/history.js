// Undo/redo history: a list of snapshots with a cursor. Pure; the editor decides what a snapshot is.

/**
 * @param {string} initial the starting snapshot
 * @param {number} [limit] how many snapshots to keep; the oldest are dropped first
 */
export function createHistory(initial, limit = 100) {
  let stack = [initial];
  let at = 0;
  return {
    /** Add a snapshot after the current one, dropping anything that was undone. False if nothing changed. */
    record(snapshot) {
      if (snapshot === stack[at]) return false;
      stack = [...stack.slice(0, at + 1), snapshot].slice(-limit);
      at = stack.length - 1;
      return true;
    },
    /** Step back and return that snapshot, or null at the start. */
    undo() { return at > 0 ? stack[--at] : null; },
    /** Step forward and return that snapshot, or null at the end. */
    redo() { return at < stack.length - 1 ? stack[++at] : null; },
    get canUndo() { return at > 0; },
    get canRedo() { return at < stack.length - 1; },
  };
}
