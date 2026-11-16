/**
 * Error codes used by the JPEG XL plugin.
 *
 * - `JXL_DECODER_MISSING`: the optional `rapier-jxl` dependency is not
 *   installed or failed to load. Other Jimp formats keep working.
 * - `JXL_DECODE_FAILED`: the decoder is available but the bitstream is
 *   malformed, truncated or otherwise invalid.
 * - `JXL_ENCODE_FAILED`: the encoder rejected the input or its options.
 */
export type JxlErrorCode =
  | "JXL_DECODER_MISSING"
  | "JXL_DECODE_FAILED"
  | "JXL_ENCODE_FAILED";

export class JxlError extends Error {
  code: JxlErrorCode;

  constructor(code: JxlErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JxlError";
    this.code = code;
  }
}

export function isJxlError(error: unknown): error is JxlError {
  return error instanceof JxlError;
}

/**
 * Errors raised by `rapier-jxl` carry a `code` string starting with `JXL_`
 * (for example `JXL_DECODE`, `JXL_INPUT`, `JXL_WASM`). Anything else that
 * reaches the codec is treated as a corrupt/invalid bitstream too.
 * Environment failures (`JXL_WASM`) are reported as a missing/unsupported
 * decoder rather than blamed on the file.
 */
export function toDecodeError(error: unknown): JxlError {
  if (error instanceof JxlError) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;

  if (code === "JXL_WASM") {
    return new JxlError(
      "JXL_DECODER_MISSING",
      `JPEG XL codec cannot run in this environment: ${detail}`,
      { cause: error }
    );
  }

  return new JxlError(
    "JXL_DECODE_FAILED",
    `Failed to decode JPEG XL bitstream: ${detail}`,
    { cause: error }
  );
}
