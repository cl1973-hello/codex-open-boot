'use strict';

/** Tiny observable store – the renderer state is small enough that a full framework
 *  would only add weight (and a runtime we would have to keep patched). */
function createStore(initial) {
  let state = initial;
  const subscribers = new Set();

  return {
    get() {
      return state;
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      state = next;
      subscribers.forEach((fn) => {
        try {
          fn(state);
        } catch (error) {
          console.error('store subscriber failed', error);
        }
      });
      return state;
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

module.exports = { createStore };
