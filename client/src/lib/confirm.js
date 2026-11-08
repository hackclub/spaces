import { writable, get } from 'svelte/store';

export function createConfirm(timeoutMs = 4000) {
  const armed = writable(null);
  let timer;

  const disarm = () => {
    clearTimeout(timer);
    armed.set(null);
  };

  return {
    armed,
    disarm,
    ask(key, action) {
      clearTimeout(timer);
      if (get(armed) === key) {
        armed.set(null);
        return action();
      }
      armed.set(key);
      timer = setTimeout(() => armed.set(null), timeoutMs);
    }
  };
}
