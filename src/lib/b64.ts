/**
 * Декодирует строку base64 / base64url в Uint8Array.
 *
 * Поддерживает:
 * - обычный base64 (`+` `/`)
 * - base64url (`-` `_`)
 *
 * Используется для:
 * - декодирования бинарных данных (например, спектрограммы),
 *   пришедших с backend в JSON-виде
 *
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);

  /**
   * Нормализуем base64url → base64.
   */
  let norm = b64.replace(/-/g, "+").replace(/_/g, "/");

  /**
   * Восстанавливаем padding (=), если он был опущен.
   * Длина base64 должна быть кратна 4.
   */
  const pad = norm.length % 4;
  if (pad) {
    norm += "=".repeat(4 - pad);
  }

  /**
   * atob возвращает бинарную строку (charCode 0..255).
   */
  const bin = atob(norm);

  /**
   * Преобразуем бинарную строку в Uint8Array.
   */
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }

  return out;
}
