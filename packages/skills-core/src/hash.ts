export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: subtle.digest rejects SharedArrayBuffer views.
  const view = bytes.buffer instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
