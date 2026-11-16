import * as BMP from "bmp-ts";

import {
  DecodeLimitOptions,
  ImageCorruptError,
  estimateDecodeBytes,
  observeDecodeMemory,
  scan,
} from "@jimp/utils";
import { Bitmap, Format } from "@jimp/types";

import { guardBmpDecode, readBmpHeader } from "./decode-guard.js";

export type { BmpColor } from "bmp-ts";
export { BmpCompression } from "bmp-ts";

type Pretty<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? T[K]
    : T[K] extends object
      ? Pretty<T[K]>
      : T[K];
};

export type EncodeOptions = Pretty<
  Partial<
    Pick<
      BMP.BmpImage,
      | "palette"
      | "colors"
      | "importantColors"
      | "hr"
      | "vr"
      | "reserved1"
      | "reserved2"
    >
  >
>;

export interface DecodeBmpOptions {
  toRGBA?: boolean;
  /**
   * Resource limits enforced before any pixel buffer is allocated. Defaults
   * to 80M pixels / 1.6GB and can be overridden globally via the
   * `JIMP_DECODE_MAX_*` environment variables or per call here.
   */
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxMemory?: number;
  onPeakMemory?: DecodeLimitOptions["onPeakMemory"];
}

function encode(image: Bitmap, options: EncodeOptions = {}) {
  scan(
    { bitmap: image },
    0,
    0,
    image.width,
    image.height,
    function (_, __, index) {
      const red = image.data[index + 0]!;
      const green = image.data[index + 1]!;
      const blue = image.data[index + 2]!;
      const alpha = image.data[index + 3]!;

      image.data[index + 0] = alpha;
      image.data[index + 1] = blue;
      image.data[index + 2] = green;
      image.data[index + 3] = red;
    },
  );

  return BMP.encode({ ...image, ...options }).data;
}

function decode(data: Buffer, options?: DecodeBmpOptions) {
  // Header parsing is allocation free, so it is safe to run ahead of the
  // memory observer to populate the peak report. Corrupt headers report a
  // zero estimate and surface as ImageCorruptError from inside the guard.
  let estimatedBytes = 0;

  try {
    const { width, height } = readBmpHeader(data);
    estimatedBytes = estimateDecodeBytes(width, height, 0);
  } catch {
    // reported through guardBmpDecode below
  }

  const result = observeDecodeMemory(
    "image/bmp",
    estimatedBytes,
    options,
    () => {
      guardBmpDecode(data, options);

      try {
        return BMP.decode(data, options);
      } catch (error) {
        if (error instanceof ImageCorruptError) {
          throw error;
        }

        // bmp-ts signals truncated/malformed payloads with plain Error or
        // RangeError; normalise them so callers can tell corruption apart
        // from an ImageLimitError policy rejection.
        throw new ImageCorruptError(
          `BMP file is malformed and cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
    },
  );

  scan(
    { bitmap: result },
    0,
    0,
    result.width,
    result.height,
    function (_, __, index) {
      // const alpha = result.data[index + 0]!;
      const blue = result.data[index + 1]!;
      const green = result.data[index + 2]!;
      const red = result.data[index + 3]!;

      result.data[index + 0] = red;
      result.data[index + 1] = green;
      result.data[index + 2] = blue;
      result.data[index + 3] = 0xff;
    },
  );

  return result as Bitmap;
}

export function msBmp() {
  return {
    mime: "image/x-ms-bmp",
    encode,
    decode,
  } satisfies Format<"image/x-ms-bmp">;
}

export default function bmp() {
  return {
    mime: "image/bmp",
    encode,
    decode,
  } satisfies Format<"image/bmp">;
}
