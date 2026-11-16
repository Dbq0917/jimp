import { createJimp } from "@jimp/core";
import { expect, test, describe, beforeEach } from "vitest";

import jpeg from "@jimp/js-jpeg";
import * as resizePlugin from "@jimp/plugin-resize";

import jxl, {
  initJxl,
  JXL_CODEC_ID,
  jxlImplementation,
  JXL_METADATA,
  JXL_MIME,
  resetJxlCodec,
} from "./index.js";
import type { JxlCodec } from "./codec.js";

const Jimp = createJimp({
  formats: [jxl, jpeg],
  plugins: [resizePlugin.methods],
});

/** Minimal structurally-valid ICC profile: 132-byte header, zero tags. */
function makeIcc(): Uint8Array {
  const icc = new Uint8Array(140);
  const view = new DataView(icc.buffer);
  view.setUint32(0, icc.length);
  icc.set([...("acsp" as string)].map((c) => c.charCodeAt(0)), 36);
  icc.set([...("RGB " as string)].map((c) => c.charCodeAt(0)), 16);
  icc.set([...("XYZ " as string)].map((c) => c.charCodeAt(0)), 20);
  return icc;
}

let codec: JxlCodec;

async function makeJxl(options: {
  width: number;
  height: number;
  bitDepth: 8 | 10;
  icc?: Uint8Array;
  transparent?: boolean;
}): Promise<Buffer> {
  const { width, height, bitDepth } = options;
  const max = bitDepth === 8 ? 255 : 1023;
  const channelCount = width * height * 4;
  const pixels =
    bitDepth === 8
      ? new Uint8Array(channelCount)
      : new Uint16Array(channelCount);

  for (let index = 0; index < width * height; index++) {
    pixels[index * 4] = (index * 37) % (max + 1);
    pixels[index * 4 + 1] = Math.floor(max / 2);
    pixels[index * 4 + 2] = max - index;
    pixels[index * 4 + 3] =
      options.transparent && index === 0 ? 0 : max;
  }

  const result = await codec.encoder.encode(
    {
      data: pixels,
      width,
      height,
      bitDepth,
      ...(options.icc ? { icc: options.icc } : {}),
    },
    { fidelity: "exact", effort: 2 }
  );

  const bytes = result instanceof Uint8Array ? result : result.bytes;
  return Buffer.from(bytes);
}

beforeEach(async () => {
  resetJxlCodec();
  codec = await initJxl();
});

describe("JPEG XL plugin metadata", () => {
  test("registers image/jxl with an identifiable implementation", () => {
    const format = jxl();
    expect(format.mime).toBe(JXL_MIME);
    expect(format.mime).toBe("image/jxl");
    expect(format.hasAlpha).toBe(true);
    expect(JXL_CODEC_ID).toBe("rapier-jxl");
    expect(jxlImplementation.codec).toBe(JXL_CODEC_ID);
    expect(jxlImplementation.mime).toBe(JXL_MIME);

    const instance = new Jimp({ width: 1, height: 1 });
    const registered = instance.formats.find(
      (candidate) => candidate.mime === JXL_MIME
    );
    expect(registered).toBeDefined();
    expect(jxlImplementation.name).toBe("@jimp/wasm-jxl");
  });
});

describe("8-bit JXL round trip", () => {
  test("preserves pixels and reports 8-bit depth", async () => {
    const source = await makeJxl({ width: 8, height: 8, bitDepth: 8 });

    const image = await Jimp.fromBuffer(source);
    expect(image.bitmap.width).toBe(8);
    expect(image.bitmap.height).toBe(8);
    expect(image.bitmap[JXL_METADATA]).toBeUndefined();

    const roundTripped = await image.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const decoded = await codec.decoder.decode(
      new Uint8Array(roundTripped),
      { format: "uint8" }
    );

    const original = await codec.decoder.decode(new Uint8Array(source), {
      format: "uint8",
    });
    expect(decoded.bitDepth).toBe(8);
    expect(Buffer.from(decoded.data)).toEqual(Buffer.from(original.data));
  });

  test("preserves the alpha channel", async () => {
    const source = await makeJxl({
      width: 4,
      height: 4,
      bitDepth: 8,
      transparent: true,
    });

    const image = await Jimp.fromBuffer(source);
    expect(image.bitmap.data[3]).toBe(0);

    const roundTripped = await image.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const decoded = await codec.decoder.decode(
      new Uint8Array(roundTripped),
      { format: "uint8" }
    );
    expect(decoded.extraChannels.length).toBeGreaterThan(0);
    expect(decoded.data[3]).toBe(0);
  });

  test("preserves an embedded ICC profile", async () => {
    const icc = makeIcc();
    const source = await makeJxl({
      width: 4,
      height: 4,
      bitDepth: 8,
      icc,
    });

    const image = await Jimp.fromBuffer(source);
    const roundTripped = await image.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const decoded = await codec.decoder.decode(
      new Uint8Array(roundTripped),
      { format: "uint8" }
    );

    expect(decoded.icc).not.toBeNull();
    expect(Buffer.from(decoded.icc!)).toEqual(Buffer.from(icc));
  });

  test("supports lossy quality and lossless modes with effort", async () => {
    const source = await makeJxl({ width: 32, height: 32, bitDepth: 8 });
    const image = await Jimp.fromBuffer(source);

    const lossy = await image.getBuffer(JXL_MIME, {
      quality: 50,
      effort: 1,
    });
    const lossless = await image.getBuffer(JXL_MIME, {
      lossless: true,
      effort: 9,
    });

    expect(lossy).not.toEqual(lossless);
    expect(lossless.length).toBeGreaterThan(0);
  });

  test("rejects invalid effort values", async () => {
    const image = new Jimp({ width: 4, height: 4, color: 0xffffffff });
    await expect(
      image.getBuffer(JXL_MIME, { effort: 10 as unknown as 9 })
    ).rejects.toThrow();
  });
});

describe("10-bit JXL round trip", () => {
  test("preserves pixels, bit depth, ICC profile and alpha", async () => {
    const icc = makeIcc();
    const source = await makeJxl({
      width: 8,
      height: 8,
      bitDepth: 10,
      icc,
      transparent: true,
    });

    const image = await Jimp.fromBuffer(source);
    const metadata = image.bitmap[JXL_METADATA];
    expect(metadata).toBeDefined();
    expect(metadata?.sourceBitDepth).toBe(10);
    expect(metadata?.data).toBeInstanceOf(Uint16Array);
    expect(metadata?.icc).toBeDefined();
    expect(Buffer.from(metadata!.icc!)).toEqual(Buffer.from(icc));

    // 8-bit RGBA view stays available for the resize/watermark pipeline.
    expect(image.bitmap.data.length).toBe(8 * 8 * 4);
    expect(image.bitmap.data[3]).toBe(0);

    const roundTripped = await image.getBuffer(JXL_MIME);
    const decoded = await codec.decoder.decode(
      new Uint8Array(roundTripped),
      { format: "auto" }
    );

    const original = await codec.decoder.decode(new Uint8Array(source), {
      format: "auto",
    });

    // Source bit depth survives.
    expect(decoded.header?.bitDepth?.bits).toBe(10);
    // ICC profile is byte-identical.
    expect(decoded.icc).not.toBeNull();
    expect(Buffer.from(decoded.icc!)).toEqual(Buffer.from(icc));
    expect(Buffer.from(decoded.icc!)).toEqual(
      Buffer.from(original.icc!)
    );
    // Full-precision pixels are exactly preserved.
    expect(decoded.data).toBeInstanceOf(Uint16Array);
    expect(Buffer.from(decoded.data)).toEqual(Buffer.from(original.data));
    // Alpha extra channel is retained, including the transparent pixel.
    expect(decoded.extraChannels.length).toBeGreaterThan(0);
    expect(decoded.data[3]).toBe(0);
  });

  test("falls back to RGBA8 after an in-place edit", async () => {
    const source = await makeJxl({ width: 8, height: 8, bitDepth: 10 });
    const image = await Jimp.fromBuffer(source);
    expect(image.bitmap[JXL_METADATA]).toBeDefined();

    // Simulate a watermark/blit style in-place mutation.
    const expected = 7;
    image.bitmap.data[0] = expected;

    const output = await image.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const decoded = await codec.decoder.decode(new Uint8Array(output), {
      format: "uint8",
    });
    expect(decoded.format).toBe("uint8");
    expect(decoded.data[0]).toBe(expected);
  });
});

describe("decode error handling", () => {
  test("distinguishes a corrupt file from a missing decoder", async () => {
    // Valid ff 0a signature so the file reaches the decoder, which then
    // rejects the malformed remainder.
    const corrupt = Buffer.from([
      0xff, 0x0a, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5,
    ]);

    try {
      await Jimp.fromBuffer(corrupt);
      throw new Error("expected fromBuffer to fail");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("JXL_DECODE_FAILED");
    }
  });
});

describe("batch initialization", () => {
  test("initializes the codec environment once for many images", async () => {
    resetJxlCodec();
    let loadCount = 0;
    const loaded: JxlCodec = await initJxl();
    const { setJxlCodecLoader } = await import("./codec.js");
    setJxlCodecLoader(async () => {
      loadCount += 1;
      return loaded;
    });

    const files = await Promise.all(
      Array.from({ length: 5 }, () =>
        makeJxl({ width: 4, height: 4, bitDepth: 8 })
      )
    );

    const images = await Promise.all(files.map((file) => Jimp.fromBuffer(file)));
    expect(images).toHaveLength(5);
    expect(loadCount).toBe(1);

    const buffers = await Promise.all(
      images.map((image) => image.getBuffer(JXL_MIME, { effort: 1 }))
    );
    expect(buffers).toHaveLength(5);
    expect(loadCount).toBe(1);

    resetJxlCodec();
  });
});

describe("other formats keep working", () => {
  test("jpeg decode and encode are unaffected by the JXL plugin", async () => {
    const source = await makeJxl({ width: 4, height: 4, bitDepth: 8 });
    const image = await Jimp.fromBuffer(source);

    const jpegBuffer = await image.getBuffer("image/jpeg", { quality: 80 });
    expect(jpegBuffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const reRead = await Jimp.fromBuffer(jpegBuffer);
    expect(reRead.bitmap.width).toBe(4);
    expect(reRead.mime).toBe("image/jpeg");
  });
});

describe("decode -> resize -> watermark chain", () => {
  test("10-bit source stays lossless when untouched and degrades safely after edits", async () => {
    const source = await makeJxl({
      width: 16,
      height: 16,
      bitDepth: 10,
      icc: makeIcc(),
    });

    // No pixel operation: the high-precision branch keeps the 10-bit data.
    const untouched = await Jimp.fromBuffer(source);
    const lossless = await untouched.getBuffer(JXL_MIME);
    const decodedLossless = await codec.decoder.decode(
      new Uint8Array(lossless),
      { format: "auto" }
    );
    expect(decodedLossless.header?.bitDepth?.bits).toBe(10);

    // Resize replaces the bitmap object, so preserved high-precision data is
    // dropped or invalidated by the fingerprint check, so resampled pixels
    // are never mislabelled as the original 10-bit samples.
    const resized = await Jimp.fromBuffer(source);
    expect(resized.bitmap[JXL_METADATA]).toBeDefined();
    resized.resize({ w: 8, h: 8 });
    expect(resized.bitmap.width).toBe(8);
    const resizedBuffer = await resized.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const resizedDecoded = await codec.decoder.decode(
      new Uint8Array(resizedBuffer),
      { format: "uint8" }
    );
    expect(resizedDecoded.format).toBe("uint8");
    expect(resizedDecoded.width).toBe(8);

    // After an in-place watermark-style edit the stale high-precision branch
    // is rejected and encoding runs on the current RGBA8 view instead.
    const edited = await Jimp.fromBuffer(source);
    edited.bitmap.data[0] = 12;
    edited.bitmap.data[1] = 34;
    edited.bitmap.data[2] = 56;
    edited.bitmap.data[3] = 78;
    const watermarked = await edited.getBuffer(JXL_MIME, {
      lossless: true,
    });
    const decodedEdited = await codec.decoder.decode(
      new Uint8Array(watermarked),
      { format: "uint8" }
    );
    expect(decodedEdited.format).toBe("uint8");
    expect(Array.from(decodedEdited.data.slice(0, 4))).toEqual([
      12, 34, 56, 78,
    ]);
  });
});
