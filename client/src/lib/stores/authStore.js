import { writable } from 'svelte/store';

export const user = writable(null);
export const authenticated = writable(false);

export async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) {
      authenticated.set(false);
      user.set(null);
      return false;
    }
    const data = await res.json();
    if (data.authenticated) {
      authenticated.set(true);
      user.set({ name: data.name, email: data.email });
      return true;
    } else {
      authenticated.set(false);
      user.set(null);
      return false;
    }
  } catch {
    authenticated.set(false);
    user.set(null);
    return false;
  }
}
