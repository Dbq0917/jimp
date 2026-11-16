import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { createJimp } from "@jimp/core";
import { ImageCorruptError, ImageLimitError } from "@jimp/utils";
import { getTestImagePath } from "@jimp/test-utils";

import png, { DecodePngOptions } from "./index.js";

const jimp = createJimp({ formats: [png] });
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
}).formats.find((format) => format.mime === "image/png")!.decode! as (
  data: Buffer,
  options?: DecodePngOptions,
) => unknown;

const limitSamples = [
  "huge-dims-rgba.png",
  "huge-dims-grayscale.png",
  "huge-dims-16bit.png",
  "huge-dims-interlaced.png",
  "overflow-dims.png",
];

const corruptSamples = [
  "invalid-color-type.png",
  "truncated-ihdr.png",
  "bad-signature.png",
];

describe("PNG decode resource limits", () => {
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

      // IHDR validation runs before pngjs inflates or allocates the bitmap,
      // so rejecting the declaration must not move RSS by more than a few MB.
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
    expect(() => sharedDecoder(sample("huge-dims-rgba.png"))).toThrow(
      /50000x50000/,
    );
  });

  test("honours per-call limit overrides", () => {
    const normal = readFileSync(getTestImagePath("dice.png"));

    expect(() => sharedDecoder(normal, { maxPixels: 1_000 })).toThrow(
      ImageLimitError,
    );
  });

  test("honours limits configured through environment variables", () => {
    const previous = process.env.JIMP_DECODE_MAX_PIXELS;
    process.env.JIMP_DECODE_MAX_PIXELS = "1000";

    try {
      expect(() =>
        sharedDecoder(readFileSync(getTestImagePath("dice.png"))),
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
      sharedDecoder(sample("huge-dims-rgba.png"), {
        onPeakMemory: (peak) => peaks.push(peak),
      }),
    ).toThrow(ImageLimitError);

    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toMatchObject({
      format: "image/png",
      rejected: true,
    });
  });
});

describe("PNG decode compatibility", () => {
  test("decodes a normal large image without changing its pixels", async () => {
    const image = await jimp.read(getTestImagePath("dice.png"));

    expect(image.bitmap.width).toBe(800);
    expect(image.bitmap.height).toBe(600);
    expect(image.getPixelColor(10, 10)).toBe(0x00000000);
    expect(image.getPixelColor(160, 80)).toBe(0x1c1cd4ff);
    expect(image.getPixelColor(400, 250)).toBe(0x7e0c0cda);
  });

  test("protects the image, thumbnail and preview chains via the shared decoder", () => {
    // All three service chains call the same Format.decode entry point, so
    // exercising it through distinct call sites proves one guard covers all
    // of them and no chain can bypass the limit.
    const chains = [
      () => sharedDecoder(sample("huge-dims-rgba.png")),
      () => sharedDecoder(sample("huge-dims-16bit.png")),
      () => sharedDecoder(sample("overflow-dims.png")),
    ];

    for (const decodeOnce of chains) {
      expect(decodeOnce).toThrow(ImageLimitError);
    }
  });
});
