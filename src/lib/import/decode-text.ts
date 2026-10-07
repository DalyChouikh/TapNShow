/**
 * File bytes as text: UTF-16 when the file starts with a UTF-16 byte-order mark (Excel's "Unicode
 * Text" export), else UTF-8 when valid (a leading BOM is dropped by TextDecoder), otherwise
 * Windows-1252 — what Excel's "CSV" export uses on French and other Western Windows setups.
 */
export function decodeText(bytes: ArrayBuffer): string {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] === 0xff && head[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (head[0] === 0xfe && head[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
