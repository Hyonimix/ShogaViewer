export function createStore(initialState = {}) {
  let state = Object.freeze({ ...initialState });
  const listeners = new Set();

  const getState = () => state;

  const setState = (patch, meta = {}) => {
    const nextState = Object.freeze({ ...state, ...(typeof patch === 'function' ? patch(state) : patch) });
    if (nextState === state) return state;
    state = nextState;
    listeners.forEach((listener) => listener(state, meta));
    return state;
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { getState, setState, subscribe };
}
