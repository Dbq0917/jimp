import { Bitmap, Format } from "@jimp/types";
import z from "zod";

import {
  initJxl,
  type JxlCodec,
  type JxlDecodedImage,
} from "./codec.js";
import { JxlError, toDecodeError } from "./errors.js";

export { JxlError, isJxlError, type JxlErrorCode } from "./errors.js";
export {
  initJxl,
  resetJxlCodec,
  setJxlCodecLoader,
  type JxlCodec,
  type JxlCodecLoader,
} from "./codec.js";

export const JXL_MIME = "image/jxl" as const;

/**
 * Implementation identifier so operators can tell which JXL backend is in
 * use when listing registered plugins.
 */
export const JXL_CODEC_ID = "rapier-jxl" as const;

/**
 * Self-describing implementation record. Imported directly when operators
 * need to list which JXL backend is active, without touching the Jimp core
 * registry.
 */
export const jxlImplementation = {
  name: "@jimp/wasm-jxl",
  mime: JXL_MIME,
  codec: JXL_CODEC_ID,
} as const;

/**
 * High-precision data carried alongside Jimp's 8-bit RGBA bitmap.
 *
 * Jimp's processing pipeline (resize, watermark, color plugins) is 8-bit, so
 * the bitmap itself always holds RGBA8 samples. Files decoded from a deeper
 * source (for example camera 10-bit JXL) keep their original samples here so
 * that an untouched image can be re-encoded without any precision loss.
 *
 * The fingerprint guards against in-place edits: `fingerprint` hashes the
 * RGBA8 view produced at decode time. Operations that replace the bitmap
 * object (resize, crop, ...) drop this metadata automatically; in-place edits
 * (blit, watermark) change the bytes, mismatch the fingerprint and make the
 * encoder fall back to the current RGBA8 buffer.
 */
export interface JxlMetadata {
  /** Original source bit depth, e.g. 8 or 10. */
  sourceBitDepth: number;
  /** Full-precision interleaved straight RGBA samples. */
  data: Uint8Array | Uint16Array;
  /** Bit depth of the words in `data` (16 for 9-16 bit sources). */
  dataBitDepth: number;
  /** Embedded ICC profile, or null when the file had none. */
  icc: Uint8Array | null;
  /** FNV-1a hash of the RGBA8 view at decode time. */
  fingerprint: number;
}

export const JXL_METADATA: unique symbol = Symbol.for("@jimp/wasm-jxl/metadata");

declare module "@jimp/types" {
  interface Bitmap {
    [JXL_METADATA]?: JxlMetadata;
  }
}

const JxlEncodeOptionsSchema = z.object({
  /**
   * Lossy quality from 1 (smallest) to 100. Ignored when `lossless` is true.
   * @default 75
   */
  quality: z.number().min(1).max(100).optional().default(75),
  /**
   * Encode losslessly. Defaults to true when the bitmap still carries the
   * untouched high-precision samples decoded from a JXL file.
   */
  lossless: z.boolean().optional(),
  /**
   * Encoder effort, 1 (fastest, for batch processing) to 9 (smallest, for
   * archival ingestion). Same fidelity at every effort, only the time/size
   * trade-off changes.
   * @default 7
   */
  effort: z.number().int().min(1).max(9).optional().default(7),
  /**
   * Override the embedded ICC profile. When omitted, a profile preserved at
   * decode time is written back unchanged.
   */
  icc: z.instanceof(Uint8Array).optional(),
});

export type JxlEncodeOptions = z.infer<typeof JxlEncodeOptionsSchema>;

/** FNV-1a 32-bit, dependency-free so the plugin works in browser builds. */
function fingerprint(data: Uint8Array): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < data.length; index++) {
    hash ^= data[index]!;
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/**
 * The decoder presents 9-16 bit sources as full-range 16-bit words. To write
 * the original bit depth back we undo the normalization `v16 = round(vN *
 * 65535 / maxN)`. The two operations round-trip exactly for every value in
 * the source range.
 */
function downshiftToSourceDepth(
  words: Uint8Array | Uint16Array,
  sourceBitDepth: number
): { data: Uint8Array | Uint16Array; bitDepth: 8 | 10 | 12 | 16 } {
  if (words instanceof Uint8Array) {
    return { data: words, bitDepth: 8 };
  }

  if (sourceBitDepth === 16) {
    return { data: words, bitDepth: 16 };
  }

  const maxSource = 2 ** sourceBitDepth - 1;
  const out = new Uint16Array(words.length);

  for (let index = 0; index < words.length; index++) {
    out[index] = Math.round((words[index]! * maxSource) / 65535);
  }

  return { data: out, bitDepth: sourceBitDepth as 8 | 10 | 12 | 16 };
}

function isUint8Array(data: unknown): data is Uint8Array {
  return data instanceof Uint8Array || data instanceof Uint8ClampedArray;
}

/**
 * Both JXL signatures start with `ff 0a`: the bare codestream marker and the
 * ISOBMFF container (`ff 0a ... JXL ` box). Anything else cannot be a JXL.
 */
function hasJxlSignature(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0xff && data[1] === 0x0a;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function decodeToRgba8(
  codec: JxlCodec,
  data: Buffer
): Promise<{
  rgba8: Uint8Array;
  highPrecision: JxlDecodedImage | null;
  icc: Uint8Array | null;
  width: number;
  height: number;
}> {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  // A single auto decode keeps the native precision (uint16 for 9-16 bit
  // sources). The RGBA8 view Jimp operates on is derived from it in JS, so a
  // batch job decodes each file exactly once.
  const full = await codec.decoder.decode(bytes, { format: "auto" });

  if (full.format === "uint8" || isUint8Array(full.data)) {
    return {
      rgba8: new Uint8Array(
        full.data.buffer,
        full.data.byteOffset,
        full.data.byteLength
      ),
      highPrecision: null,
      icc: full.icc,
      width: full.width,
      height: full.height,
    };
  }

  const rgba8 = new Uint8Array(full.data.length);

  for (let index = 0; index < full.data.length; index++) {
    rgba8[index] = Math.round((full.data[index]! * 255) / 65535);
  }

  return {
    rgba8,
    highPrecision: full,
    icc: full.icc,
    width: full.width,
    height: full.height,
  };
}

export default function jxl() {
  return {
    mime: JXL_MIME,
    hasAlpha: true,
    decode: async (data: Buffer) => {
      if (!hasJxlSignature(data)) {
        throw new JxlError(
          "JXL_DECODE_FAILED",
          "Buffer is not a JPEG XL bitstream (missing ff 0a signature)."
        );
      }

      const codec = await initJxl().catch((error: unknown) => {
        throw error instanceof JxlError
          ? error
          : new JxlError(
              "JXL_DECODER_MISSING",
              "JPEG XL codec could not be initialized.",
              { cause: error }
            );
      });

      let rgba8: Uint8Array;
      let highPrecision: JxlDecodedImage | null;
      let icc: Uint8Array | null;
      let width: number;
      let height: number;

      try {
        ({ rgba8, highPrecision, icc, width, height } = await decodeToRgba8(
          codec,
          data
        ));
      } catch (error) {
        throw toDecodeError(error);
      }

      const bitmap: Bitmap = {
        data: toBuffer(rgba8),
        width,
        height,
      };

      if (highPrecision || icc) {
        const sourceBitDepth = highPrecision
          ? (highPrecision.header?.bitDepth?.bits ?? highPrecision.bitDepth)
          : 8;

        bitmap[JXL_METADATA] = {
          sourceBitDepth,
          data: highPrecision ? highPrecision.data : rgba8,
          dataBitDepth: highPrecision ? highPrecision.bitDepth : 8,
          icc,
          fingerprint: fingerprint(rgba8),
        };
      }

      return bitmap;
    },
    encode: async (bitmap, options: Partial<JxlEncodeOptions> = {}) => {
      const { quality, lossless, effort, icc: iccOption } =
        JxlEncodeOptionsSchema.parse(options);

      const codec = await initJxl();
      const metadata = bitmap[JXL_METADATA];
      const rgba8 = new Uint8Array(
        bitmap.data.buffer,
        bitmap.data.byteOffset,
        bitmap.data.byteLength
      );

      const metadataStale =
        !metadata || metadata.fingerprint !== fingerprint(rgba8);
      const useLossless = lossless ?? (!metadataStale && !!metadata);
      const icc = iccOption ?? (!metadataStale ? metadata?.icc : null) ?? null;

      let pixels: Uint8Array | Uint16Array = rgba8;
      let bitDepth: 8 | 10 | 12 | 16 = 8;

      if (!metadataStale && metadata) {
        const restored = downshiftToSourceDepth(
          metadata.data,
          metadata.sourceBitDepth
        );
        pixels = restored.data;
        bitDepth = restored.bitDepth;
      }

      let result: { bytes: Uint8Array } | Uint8Array;

      try {
        result = await codec.encoder.encode(
          {
            data: pixels,
            width: bitmap.width,
            height: bitmap.height,
            bitDepth,
            ...(icc ? { icc } : {}),
          },
          {
            fidelity: useLossless ? "exact" : { quality },
            effort,
          }
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new JxlError(
          "JXL_ENCODE_FAILED",
          `Failed to encode JPEG XL bitstream: ${detail}`,
          { cause: error }
        );
      }

      const bytes = result instanceof Uint8Array ? result : result.bytes;
      return toBuffer(bytes);
    },
  } satisfies Format<typeof JXL_MIME>;
}
