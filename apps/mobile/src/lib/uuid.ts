import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 id. Every record created offline gets one so retries never duplicate. */
export function uuid(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  return native ? native.call(globalThis.crypto) : Crypto.randomUUID();
}
