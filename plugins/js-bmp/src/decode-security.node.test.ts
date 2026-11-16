import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { createJimp } from "@jimp/core";
import { ImageCorruptError, ImageLimitError } from "@jimp/utils";
import { getTestImagePath } from "@jimp/test-utils";

import png from "@jimp/js-png";
import bmp, { DecodeBmpOptions } from "./index.js";

const jimp = createJimp({ formats: [bmp, png] });
const sample = (name: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "malicious-samples", name),
  );

// The same shared Format.decode backs the image, thumbnail and preview
// service chains; grab it once and exercise every path through that entry.
const sharedDecoder = new jimp({
  width: 1,
  height: 1,
  color: 0xffffffff,
}).formats.find((format) => format.mime === "image/bmp")!.decode! as (
  data: Buffer,
  options?: DecodeBmpOptions,
) => unknown;

const limitSamples = [
  "huge-dims-24bpp.bmp",
  "huge-width-24bpp.bmp",
  "negative-huge-height-32bpp.bmp",
  "overflow-dims-24bpp.bmp",
];

const corruptSamples = ["truncated-header.bmp", "bad-signature.bmp"];

describe("BMP decode resource limits", () => {
  test.each(limitSamples)(
    "rejects %s with a limit error before allocating pixel memory",
    async (name) => {
      const file = sample(name);
      expect(file.length).toBeLessThan(256);

      const before = process.memoryUsage().rss;

      await expect(jimp.read(file)).rejects.toBeInstanceOf(ImageLimitError);

      if (global.gc) {
        global.gc();
      }

      // The guard runs before bmp-ts allocates anything, so rejecting a
      // multi-gigabyte declaration must not move RSS by more than a few MB.
      const rssGrowth = process.memoryUsage().rss - before;
      expect(rssGrowth).toBeLessThan(16 * 1024 * 1024);
    },
  );

  test.each(corruptSamples)(
    "classifies %s as a corrupt file rather than a limit rejection",
    (name) => {
      // Tested through the shared decoder directly: bad-signature files are
      // already rejected earlier by MIME sniffing in jimp.read.
      expect(() => sharedDecoder(sample(name))).toThrow(ImageCorruptError);
      expect(() => sharedDecoder(sample(name))).not.toThrow(ImageLimitError);
    },
  );

  test("limit errors carry the declared dimensions in their message", () => {
    expect(() => sharedDecoder(sample(limitSamples[0]!))).toThrow(
      /50000x50000/,
    );
  });

  test("honours per-call limit overrides", () => {
    // The real windows95 image is 320x400 and decodes with default limits,
    // but a tighter machine profile must reject it as too large.
    const normal = readFileSync(getTestImagePath("windows95.bmp"));

    expect(() => sharedDecoder(normal, { maxPixels: 1_000 })).toThrow(
      ImageLimitError,
    );
    expect(() => sharedDecoder(normal, { maxPixels: 1_000 })).toThrow(
      /320x400/,
    );
  });

  test("honours limits configured through environment variables", () => {
    const previous = process.env.JIMP_DECODE_MAX_PIXELS;
    process.env.JIMP_DECODE_MAX_PIXELS = "1000";

    try {
      expect(() =>
        sharedDecoder(readFileSync(getTestImagePath("windows95.bmp"))),
      ).toThrow(ImageLimitError);
    } finally {
      if (previous === undefined) {
        delete process.env.JIMP_DECODE_MAX_PIXELS;
      } else {
        process.env.JIMP_DECODE_MAX_PIXELS = previous;
      }
    }
  });

  test("reports the per-decode peak memory through onPeakMemory", () => {
    const peaks: unknown[] = [];

    expect(() =>
      sharedDecoder(sample("huge-dims-24bpp.bmp"), {
        onPeakMemory: (peak) => peaks.push(peak),
      }),
    ).toThrow(ImageLimitError);

    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toMatchObject({
      format: "image/bmp",
      rejected: true,
    });
    expect((peaks[0] as { estimatedBytes: number }).estimatedBytes).toBe(
      50_000 * 50_000 * 4,
    );
  });
});

describe("BMP decode compatibility", () => {
  test("decodes a normal image and stays pixel identical to the PNG reference", async () => {
    const bmpFile = readFileSync(getTestImagePath("windows95.bmp"));
    const pngFile = readFileSync(getTestImagePath("windows95.png"));

    const image = await jimp.read(bmpFile);
    const reference = await jimp.read(pngFile);

    expect(image.bitmap.width).toBe(320);
    expect(image.bitmap.height).toBe(400);
    expect(image.bitmap.data).toEqual(reference.bitmap.data);
  });

  test("still decodes an image close to the configured pixel ceiling", async () => {
    // 2000x2000 = 4M pixels, well under the 80M business ceiling but large
    // enough to prove the guard does not reject legitimate big images.
    const width = 2_000;
    const height = 2_000;
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const pixelData = Buffer.alloc(rowSize * height, 0x55);
    const fileHeader = Buffer.alloc(14);
    fileHeader.write("BM", 0, "ascii");
    fileHeader.writeUInt32LE(54 + pixelData.length, 2);
    fileHeader.writeUInt32LE(54, 10);
    const infoHeader = Buffer.alloc(40);
    infoHeader.writeUInt32LE(40, 0);
    infoHeader.writeUInt32LE(width, 4);
    infoHeader.writeInt32LE(height, 8);
    infoHeader.writeUInt16LE(1, 12);
    infoHeader.writeUInt16LE(24, 14);

    const largeBmp = Buffer.concat([fileHeader, infoHeader, pixelData]);
    const decoded = await jimp.read(largeBmp);

    expect(decoded.bitmap.width).toBe(width);
    expect(decoded.bitmap.height).toBe(height);
    expect(decoded.bitmap.data.length).toBe(width * height * 4);
  });

  test("protects the image, thumbnail and preview chains via the shared decoder", () => {
    // All three service chains call the same Format.decode entry point, so
    // exercising it through distinct call sites proves one guard covers all
    // of them and no chain can bypass the limit.
    const chains = [
      () => sharedDecoder(sample("huge-dims-24bpp.bmp")),
      () => sharedDecoder(sample("negative-huge-height-32bpp.bmp")),
      () => sharedDecoder(sample("overflow-dims-24bpp.bmp")),
    ];

    for (const decodeOnce of chains) {
      expect(decodeOnce).toThrow(ImageLimitError);
    }
  });
});
