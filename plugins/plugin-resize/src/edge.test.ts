import { describe, expect, test } from "vitest";

import { createJimp } from "@jimp/core";

import { methods, ResizeStrategy } from "./index.js";

const jimp = createJimp({ plugins: [methods], formats: [] });

const BORDER = [255, 0, 0, 255] as const;
const INTERIOR = [0, 0, 0, 255] as const;
const HIGH_ORDER_MODES = [
  ResizeStrategy.BICUBIC,
  ResizeStrategy.HERMITE,
  ResizeStrategy.BEZIER,
] as const;

function makeBorderedImage(width: number, height: number) {
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color =
        x === 0 || y === 0 || x === width - 1 || y === height - 1
          ? BORDER
          : INTERIOR;
      data.set(color, (y * width + x) * 4);
    }
  }

  return jimp.fromBitmap({ width, height, data });
}

function getPixel(
  image: ReturnType<typeof makeBorderedImage>,
  x: number,
  y: number,
) {
  const pos = (y * image.bitmap.width + x) * 4;

  return Array.from(image.bitmap.data.subarray(pos, pos + 4));
}

function hasBorderOnAllSides(image: ReturnType<typeof makeBorderedImage>) {
  const { width, height } = image.bitmap;

  for (let x = 0; x < width; x++) {
    if (
      getPixel(image, x, 0).join() !== BORDER.join() ||
      getPixel(image, x, height - 1).join() !== BORDER.join()
    ) {
      return false;
    }
  }

  for (let y = 0; y < height; y++) {
    if (
      getPixel(image, 0, y).join() !== BORDER.join() ||
      getPixel(image, width - 1, y).join() !== BORDER.join()
    ) {
      return false;
    }
  }

  return true;
}

describe("high-order resize boundaries", () => {
  const cases = [
    { width: 1200, height: 800, targetWidth: 750, targetHeight: 500 },
    { width: 750, height: 1000, targetWidth: 450, targetHeight: 600 },
    { width: 900, height: 1200, targetWidth: 750, targetHeight: 1000 },
    { width: 640, height: 480, targetWidth: 333, targetHeight: 251 },
    { width: 480, height: 640, targetWidth: 317, targetHeight: 421 },
    { width: 83, height: 57, targetWidth: 61, targetHeight: 43 },
    { width: 57, height: 83, targetWidth: 43, targetHeight: 61 },
    { width: 100, height: 75, targetWidth: 97, targetHeight: 73 },
    { width: 75, height: 100, targetWidth: 73, targetHeight: 97 },
    { width: 611, height: 407, targetWidth: 403, targetHeight: 269 },
  ];

  test.each(cases)(
    "keeps all four borders for $width x $height -> $targetWidth x $targetHeight",
    ({ width, height, targetWidth, targetHeight }) => {
      const source = makeBorderedImage(width, height);

      for (const mode of HIGH_ORDER_MODES) {
        const output = source.clone().resize({
          w: targetWidth,
          h: targetHeight,
          mode,
        });

        expect(output.bitmap.width).toBe(targetWidth);
        expect(output.bitmap.height).toBe(targetHeight);
        expect({
          mode,
          borders: hasBorderOnAllSides(output),
        }).toEqual({ mode, borders: true });

        if (targetWidth > 2) {
          expect(getPixel(output, 1, Math.floor(targetHeight / 2))).toEqual(
            INTERIOR,
          );
          expect(
            getPixel(output, targetWidth - 2, Math.floor(targetHeight / 2)),
          ).toEqual(INTERIOR);
        }

        if (targetHeight > 2) {
          expect(getPixel(output, Math.floor(targetWidth / 2), 1)).toEqual(
            INTERIOR,
          );
          expect(
            getPixel(output, Math.floor(targetWidth / 2), targetHeight - 2),
          ).toEqual(INTERIOR);
        }
      }
    },
  );

  test("preserves samples when resizing to the same dimensions", () => {
    const data = Buffer.alloc(5 * 3 * 4);

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) {
        data.set([x * 50, y * 80, x * 20 + y * 10, 255], (y * 5 + x) * 4);
      }
    }

    const source = jimp.fromBitmap({ width: 5, height: 3, data });

    for (const mode of HIGH_ORDER_MODES) {
      const output = source.clone().resize({ w: 5, h: 3, mode });

      expect(output.bitmap.data.equals(source.bitmap.data), mode).toBe(true);
    }
  });

  test("does not shift a linear ramp while resizing non-integer ratios", () => {
    const sourceWidth = 100;
    const targetWidth = 73;
    const data = Buffer.alloc(sourceWidth * 4);

    for (let x = 0; x < sourceWidth; x++) {
      data.set([x * 2, x, 255 - x * 2, 255], x * 4);
    }

    const source = jimp.fromBitmap({ width: sourceWidth, height: 1, data });

    for (const mode of HIGH_ORDER_MODES) {
      const output = source.clone().resize({ w: targetWidth, h: 1, mode });

      for (let x = 0; x < targetWidth; x++) {
        const expectedRed = Math.round(
          ((x * (sourceWidth - 1)) / (targetWidth - 1)) * 2,
        );

        expect(
          Math.abs(getPixel(output, x, 0)[0]! - expectedRed),
          `${mode} at x=${x}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("replicates single-pixel rows and columns without zeroing them", () => {
    const horizontalData = Buffer.alloc(5 * 4);
    const verticalData = Buffer.alloc(5 * 4);

    for (let i = 0; i < 5; i++) {
      horizontalData.set([i * 50, 0, 0, 255], i * 4);
      verticalData.set([i * 50, 0, 0, 255], i * 4);
    }

    const horizontal = jimp.fromBitmap({
      width: 5,
      height: 1,
      data: horizontalData,
    });
    const vertical = jimp.fromBitmap({
      width: 1,
      height: 5,
      data: verticalData,
    });

    for (const mode of HIGH_ORDER_MODES) {
      const horizontalOutput = horizontal.clone().resize({ w: 10, h: 6, mode });
      const verticalOutput = vertical.clone().resize({ w: 6, h: 10, mode });

      expect(getPixel(horizontalOutput, 0, 0)).toEqual([0, 0, 0, 255]);
      expect(getPixel(horizontalOutput, 9, 0)[0]).toBe(200);
      expect(getPixel(horizontalOutput, 9, 5)[0]).toBe(200);

      expect(getPixel(verticalOutput, 0, 0)).toEqual([0, 0, 0, 255]);
      expect(getPixel(verticalOutput, 0, 9)[0]).toBe(200);
      expect(getPixel(verticalOutput, 5, 9)[0]).toBe(200);
    }
  });
});
