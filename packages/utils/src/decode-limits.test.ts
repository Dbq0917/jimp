import { describe, expect, test, vi } from "vitest";

import {
  assertDecodeLimits,
  DEFAULT_MAX_DECODE_MEMORY,
  DEFAULT_MAX_DECODE_PIXELS,
  estimateDecodeBytes,
  ImageCorruptError,
  ImageLimitError,
  observeDecodeMemory,
  resolveDecodeLimits,
  safeMultiply,
} from "./decode-limits.js";

describe("resolveDecodeLimits", () => {
  test("falls back to the 80M pixel / 400MB defaults", () => {
    expect(resolveDecodeLimits()).toEqual({
      maxWidth: DEFAULT_MAX_DECODE_PIXELS,
      maxHeight: DEFAULT_MAX_DECODE_PIXELS,
      maxPixels: DEFAULT_MAX_DECODE_PIXELS,
      maxMemory: DEFAULT_MAX_DECODE_MEMORY,
    });
  });

  test("accepts per-call overrides", () => {
    const limits = resolveDecodeLimits({
      maxWidth: 100,
      maxHeight: 200,
      maxPixels: 5_000,
      maxMemory: 10_000,
    });

    expect(limits).toEqual({
      maxWidth: 100,
      maxHeight: 200,
      maxPixels: 5_000,
      maxMemory: 10_000,
    });
  });

  test("reads limits from the environment for per-machine tuning", () => {
    const limits = resolveDecodeLimits(undefined, {
      JIMP_DECODE_MAX_WIDTH: "10",
      JIMP_DECODE_MAX_HEIGHT: "20",
      JIMP_DECODE_MAX_PIXELS: "300",
      JIMP_DECODE_MAX_MEMORY: "4000",
    });

    expect(limits).toEqual({
      maxWidth: 10,
      maxHeight: 20,
      maxPixels: 300,
      maxMemory: 4000,
    });
  });

  test("per-call overrides take precedence over environment variables", () => {
    const limits = resolveDecodeLimits(
      { maxPixels: 7 },
      { JIMP_DECODE_MAX_PIXELS: "999" },
    );

    expect(limits.maxPixels).toBe(7);
  });

  test("rejects non-positive or non-integer configuration as corruption", () => {
    expect(() => resolveDecodeLimits({ maxPixels: 0 })).toThrow(
      ImageCorruptError,
    );
    expect(() =>
      resolveDecodeLimits(undefined, { JIMP_DECODE_MAX_MEMORY: "nope" }),
    ).toThrow(ImageCorruptError);
  });
});

describe("assertDecodeLimits", () => {
  const limits = resolveDecodeLimits({
    maxWidth: 100,
    maxHeight: 100,
    maxPixels: 5_000,
    maxMemory: 100_000,
  });

  test("allows images within every limit", () => {
    expect(() => assertDecodeLimits(limits, 50, 50, 10_000)).not.toThrow();
  });

  test("rejects an oversized width with a limit error", () => {
    expect(() => assertDecodeLimits(limits, 101, 10, 10)).toThrow(
      ImageLimitError,
    );
  });

  test("rejects an oversized height with a limit error", () => {
    expect(() => assertDecodeLimits(limits, 10, 101, 10)).toThrow(
      ImageLimitError,
    );
  });

  test("rejects an oversized pixel count with a limit error", () => {
    expect(() => assertDecodeLimits(limits, 100, 100, 10)).toThrow(
      /exceeds the decode limit of 5000 pixels/,
    );
  });

  test("rejects an oversized memory estimate with a limit error", () => {
    expect(() => assertDecodeLimits(limits, 10, 10, 100_001)).toThrow(
      ImageLimitError,
    );
  });

  test.each([
    [0, 10],
    [10, 0],
    [-1, 10],
    [10.5, 10],
    [Number.NaN, 10],
  ])("reports invalid dimensions %p x %p as corruption", (width, height) => {
    expect(() => assertDecodeLimits(limits, width, height, 10)).toThrow(
      ImageCorruptError,
    );
  });
});

describe("safeMultiply", () => {
  test("keeps large products exact and returns Infinity on real overflow", () => {
    expect(safeMultiply(0x0001_0000, 0x0001_0000)).toBe(4_294_967_296);
    expect(safeMultiply(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(
      Number.POSITIVE_INFINITY,
    );
    // Non-finite inputs must never produce a finite (bypassable) result.
    expect(safeMultiply(Number.POSITIVE_INFINITY, 2)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("estimateDecodeBytes", () => {
  test("covers the RGBA output and the largest intermediate buffer", () => {
    expect(estimateDecodeBytes(10, 10, 8)).toBe(10 * 10 * 12);
    expect(estimateDecodeBytes(10, 10, 0)).toBe(10 * 10 * 4);
  });
});

describe("observeDecodeMemory", () => {
  test("reports the estimate and a non-rejected status on success", () => {
    const onPeakMemory = vi.fn();

    observeDecodeMemory("image/bmp", 1234, { onPeakMemory }, () => "ok");

    expect(onPeakMemory).toHaveBeenCalledTimes(1);
    expect(onPeakMemory.mock.calls[0]![0]).toMatchObject({
      format: "image/bmp",
      estimatedBytes: 1234,
      rejected: false,
    });
  });

  test("marks limit rejections while still reporting the peak", () => {
    const onPeakMemory = vi.fn();

    expect(() =>
      observeDecodeMemory("image/png", 999, { onPeakMemory }, () => {
        throw new ImageLimitError("too big");
      }),
    ).toThrow(ImageLimitError);

    expect(onPeakMemory.mock.calls[0]![0]).toMatchObject({
      format: "image/png",
      estimatedBytes: 999,
      rejected: true,
    });
  });

  test("does not flag corruption as a limit rejection", () => {
    const onPeakMemory = vi.fn();

    expect(() =>
      observeDecodeMemory("image/bmp", 0, { onPeakMemory }, () => {
        throw new ImageCorruptError("broken");
      }),
    ).toThrow(ImageCorruptError);

    expect(onPeakMemory.mock.calls[0]![0]!.rejected).toBe(false);
  });
});
