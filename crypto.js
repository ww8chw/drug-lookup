// 加密檔格式：iv(12 bytes) | AES-256-GCM ciphertext；金鑰 = PBKDF2-SHA256(密碼, salt, iter)
const ub = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 私密模式等情況：只是不記住 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

export async function deriveKey(pw, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: ub(saltB64), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

export async function decrypt(key, buf) {
  const u = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
}

export async function gunzipText(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function rememberKey(name, key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  let s = '';
  raw.forEach((b) => { s += String.fromCharCode(b); });
  store.set(name, btoa(s));
}

export async function loadKey(name) {
  const saved = store.get(name);
  if (!saved) return null;
  try {
    return await crypto.subtle.importKey('raw', ub(saved), 'AES-GCM', true, ['decrypt']);
  } catch (e) {
    store.del(name);
    return null;
  }
}

export function forgetKey(name) { store.del(name); }
