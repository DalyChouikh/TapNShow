import { describe, expect, it } from "vitest";
import { encodeIco } from "./ico";

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("encodeIco", () => {
  it("packs PNG images into one .ico: header, one entry per image, then the images", () => {
    const small = new Uint8Array([1, 2, 3]);
    const large = new Uint8Array([4, 5, 6, 7, 8]);
    const ico = encodeIco([
      { size: 16, png: small },
      { size: 256, png: large },
    ]);
    const data = view(ico);
    // ICONDIR: reserved 0, type 1 (icon), count 2.
    expect([
      data.getUint16(0, true),
      data.getUint16(2, true),
      data.getUint16(4, true),
    ]).toEqual([0, 1, 2]);
    // Two 16-byte ICONDIRENTRYs after the 6-byte header; images start at 6 + 2 × 16 = 38.
    const entry = (index: number) => {
      const at = 6 + index * 16;
      return {
        width: data.getUint8(at),
        height: data.getUint8(at + 1),
        planes: data.getUint16(at + 4, true),
        bitCount: data.getUint16(at + 6, true),
        bytes: data.getUint32(at + 8, true),
        offset: data.getUint32(at + 12, true),
      };
    };
    expect(entry(0)).toEqual({
      width: 16,
      height: 16,
      planes: 1,
      bitCount: 32,
      bytes: 3,
      offset: 38,
    });
    // 256 px is written as 0 (one byte).
    expect(entry(1)).toEqual({
      width: 0,
      height: 0,
      planes: 1,
      bitCount: 32,
      bytes: 5,
      offset: 41,
    });
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ico.byteLength).toBe(46);
  });

  it.each([0, 257, 12.5])(
    "refuses a size an icon entry can't hold (%s px)",
    (size) => {
      expect(() => encodeIco([{ size, png: new Uint8Array([1]) }])).toThrow(
        RangeError,
      );
    },
  );

  it("refuses an empty icon", () => {
    expect(() => encodeIco([])).toThrow(RangeError);
  });
});
