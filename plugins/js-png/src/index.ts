import { PNG, PNGOptions as PNGJSOptions } from "pngjs";
import {
  DecodeLimitOptions,
  ImageCorruptError,
  observeDecodeMemory,
} from "@jimp/utils";
import { Format } from "@jimp/types";
import { PNGFilterType, PNGColorType } from "./constants.js";
import {
  estimatePngDecodeBytes,
  guardPngDecode,
  readPngHeader,
} from "./decode-guard.js";

export type { PNGOptions as PNGJSOptions } from "pngjs";
export type PNGOptions = Omit<
  PNGJSOptions,
  "filterType" | "colorType" | "inputColorType"
> & {
  filterType?: PNGFilterType;
  colorType?: PNGColorType;
  inputColorType?: PNGColorType;
};

export interface DecodePngOptions {
  checkCRC?: boolean | undefined;
  skipRescale?: boolean | undefined;
  /**
   * Resource limits enforced against the IHDR dimensions before any pixel
   * buffer is allocated. Defaults to 80M pixels / 1.6GB and can be
   * overridden globally via the `JIMP_DECODE_MAX_*` environment variables
   * or per call here.
   */
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxMemory?: number;
  onPeakMemory?: DecodeLimitOptions["onPeakMemory"];
}

export * from "./constants.js";

export default function png() {
  return {
    mime: "image/png",
    hasAlpha: true,
    encode: (
      bitmap,
      {
        deflateLevel = 9,
        deflateStrategy = 3,
        filterType = PNGFilterType.AUTO,
        colorType,
        inputHasAlpha = true,
        ...options
      }: PNGOptions = {},
    ) => {
      const png = new PNG({
        width: bitmap.width,
        height: bitmap.height,
      });

      png.data = bitmap.data;

      return PNG.sync.write(png, {
        ...options,
        deflateLevel,
        deflateStrategy,
        filterType,
        colorType:
          typeof colorType !== "undefined"
            ? colorType
            : inputHasAlpha
              ? PNGColorType.COLOR_ALPHA
              : PNGColorType.COLOR,
        inputHasAlpha,
      });
    },
    decode: (data, options?: DecodePngOptions) => {
      let estimatedBytes = 0;

      try {
        estimatedBytes = estimatePngDecodeBytes(readPngHeader(data));
      } catch {
        // reported through guardPngDecode below
      }

      const result = observeDecodeMemory(
        "image/png",
        estimatedBytes,
        options,
        () => {
          guardPngDecode(data, options);

          try {
            return PNG.sync.read(data, options);
          } catch (error) {
            if (error instanceof ImageCorruptError) {
              throw error;
            }

            // pngjs signals truncated/invalid streams with plain Error;
            // normalise them so callers can tell corruption apart from an
            // ImageLimitError policy rejection.
            throw new ImageCorruptError(
              `PNG file is malformed and cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
              error,
            );
          }
        },
      );

      return {
        data: result.data,
        width: result.width,
        height: result.height,
      };
    },
  } satisfies Format<"image/png">;
}
