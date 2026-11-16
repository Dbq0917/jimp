import { JxlError } from "./errors.js";

/**
 * The subset of the `rapier-jxl` encoder API this plugin relies on.
 * The encoder lives in the package root entry point.
 */
export interface JxlEncoderModule {
  encode(
    input: {
      data: Uint8Array | Uint16Array;
      width: number;
      height: number;
      bitDepth?: 8 | 10 | 12 | 16;
      icc?: Uint8Array;
    },
    options: {
      fidelity: "exact" | { quality: number };
      effort: number;
    }
  ): Promise<{ bytes: Uint8Array } | Uint8Array>;
}

/**
 * The subset of the `rapier-jxl/decode` API this plugin relies on.
 */
export interface JxlDecoderModule {
  decode(
    data: Uint8Array,
    options?: { format?: "auto" | "uint8" | "uint16" }
  ): Promise<JxlDecodedImage>;
}

export interface JxlBitDepth {
  bits: number;
  exponentBits: number;
  float: boolean;
}

export interface JxlDecodedImage {
  width: number;
  height: number;
  /** `uint8` or `uint16` interleaved straight RGBA samples. */
  data: Uint8Array | Uint16Array;
  format: "uint8" | "uint16";
  /** Bit depth of the output words (8 or 16). */
  bitDepth: number;
  /** Codestream header, including the image's original bit depth. */
  header?: { bitDepth?: JxlBitDepth };
  icc: Uint8Array | null;
  extraChannels: Array<{ type: number }>;
}

export interface JxlCodec {
  encoder: JxlEncoderModule;
  decoder: JxlDecoderModule;
}

export type JxlCodecLoader = () => Promise<JxlCodec>;

/**
 * Default loader: pulls `rapier-jxl` in lazily so that simply installing
 * `@jimp/wasm-jxl` never touches the WASM binaries and a missing optional
 * dependency leaves every other Jimp format working.
 *
 * The dynamic imports are resolved against the host application's
 * `node_modules`, so the dependency only has to be installed where JXL
 * support is actually wanted.
 */
export const defaultCodecLoader: JxlCodecLoader = async () => {
  try {
    const [{ encode }, { decode }] = await Promise.all([
      import("rapier-jxl"),
      import("rapier-jxl/decode"),
    ]);

    return {
      encoder: { encode: encode as JxlEncoderModule["encode"] },
      decoder: { decode: decode as JxlDecoderModule["decode"] },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new JxlError(
      "JXL_DECODER_MISSING",
      "JPEG XL support requires the optional dependency `rapier-jxl`. " +
        `Install it to enable image/jxl (import failed: ${detail}).`,
      { cause: error }
    );
  }
};

let activeLoader: JxlCodecLoader = defaultCodecLoader;
let codecPromise: Promise<JxlCodec> | undefined;

/**
 * Replace the codec loader, mainly useful for tests that want to simulate a
 * missing dependency or inject a stub implementation.
 */
export function setJxlCodecLoader(loader: JxlCodecLoader): void {
  activeLoader = loader;
  codecPromise = undefined;
}

/**
 * Compile the WASM kernels ahead of the first image. Call once during
 * process startup; batch jobs then reuse the same environment for every
 * decode/encode instead of re-initializing per image.
 */
export function initJxl(): Promise<JxlCodec> {
  if (!codecPromise) {
    codecPromise = activeLoader();
  }

  return codecPromise;
}

/** Drop the cached codec, forcing the next call to re-initialize. */
export function resetJxlCodec(): void {
  codecPromise = undefined;
}
