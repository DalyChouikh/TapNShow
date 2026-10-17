/** Bytes of the ICONDIR header and of each ICONDIRENTRY in a `.ico` file. */
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
/** The largest side an entry can state (256 is written as 0). */
const MAX_SIZE = 256;

/**
 * A `.ico` file holding square PNG images, one entry each (the ICO format has stored PNGs
 * since Windows Vista; every current browser reads them). Sizes are whole pixels, 1 to 256.
 * @throws RangeError for no image or a size an entry can't hold
 */
export function encodeIco(
  images: ReadonlyArray<{ size: number; png: Uint8Array }>,
): Uint8Array<ArrayBuffer> {
  if (images.length === 0) {
    throw new RangeError("An icon needs at least one image.");
  }
  for (const { size } of images) {
    if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
      throw new RangeError(`An icon image can't be ${size} px.`);
    }
  }
  const imagesStart = HEADER_BYTES + images.length * ENTRY_BYTES;
  const total = images.reduce(
    (sum, { png }) => sum + png.byteLength,
    imagesStart,
  );
  const ico = new Uint8Array(total);
  const data = new DataView(ico.buffer);
  data.setUint16(0, 0, true);
  data.setUint16(2, 1, true);
  data.setUint16(4, images.length, true);
  let offset = imagesStart;
  images.forEach(({ size, png }, index) => {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    const side = size === MAX_SIZE ? 0 : size;
    data.setUint8(at, side);
    data.setUint8(at + 1, side);
    data.setUint8(at + 2, 0); // no palette
    data.setUint8(at + 3, 0); // reserved
    data.setUint16(at + 4, 1, true); // colour planes
    data.setUint16(at + 6, 32, true); // bits per pixel
    data.setUint32(at + 8, png.byteLength, true);
    data.setUint32(at + 12, offset, true);
    ico.set(png, offset);
    offset += png.byteLength;
  });
  return ico;
}
