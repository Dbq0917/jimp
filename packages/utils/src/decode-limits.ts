/**
 * Decode-time resource limits shared by every image format decoder.
 *
 * The limits are validated against the dimensions *declared in the file
 * header* before any pixel buffer is allocated, so a malformed file that
 * claims to be huge while being only a few hundred bytes long can never
 * trigger a multi-gigabyte allocation.
 */

/**
 * Largest image that the online pipeline decodes synchronously. Larger
 * images are supposed to be routed to offline processing. 80M pixels is
 * ~305 MiB once expanded to a 4-byte RGBA buffer.
 */
export const DEFAULT_MAX_DECODE_PIXELS = 80_000_000;

/**
 * Upper bound (in bytes) for the buffers created during a single decode.
 * Calibrated so the largest supported online image (80M pixels) still
 * decodes: a 4-byte RGBA output is ~320MB and PNG decoding keeps a handful
 * of full-size intermediate buffers alive at the same time. Operators on
 * smaller machines should lower this via `JIMP_DECODE_MAX_MEMORY` or the
 * per-decode `maxMemory` option rather than editing the constant.
 */
export const DEFAULT_MAX_DECODE_MEMORY = 1_600_000_000;

export interface DecodeLimits {
  /** Maximum allowed width in pixels. */
  maxWidth: number;
  /** Maximum allowed height in pixels. */
  maxHeight: number;
  /** Maximum allowed total pixel count (width * height). */
  maxPixels: number;
  /** Maximum allowed aggregate allocation in bytes during one decode. */
  maxMemory: number;
}

export interface DecodeLimitOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxMemory?: number;
  /**
   * Called once a decode finishes (or fails) with the peak external memory
   * (RSS delta) observed while decoding. Useful for load tests that need to
   * assert memory stays flat when malicious inputs are rejected.
   */
  onPeakMemory?: (peak: DecodeMemoryPeak) => void;
}

export interface DecodeMemoryPeak {
  /** Format identifier supplied by the decoder, e.g. "image/bmp". */
  format: string;
  /** Peak RSS in bytes reached during the decode. */
  peakRssBytes: number;
  /** RSS in bytes measured immediately before decoding started. */
  baselineRssBytes: number;
  /** Largest single allocation the decoder estimated up front, in bytes. */
  estimatedBytes: number;
  /** Whether the decode was rejected before any pixel buffer was built. */
  rejected: boolean;
}

function currentRss(): number | undefined {
  return globalThis.process?.memoryUsage?.()?.rss;
}

/**
 * Wrap a decode so peak RSS is sampled around it and reported through
 * {@link DecodeLimitOptions.onPeakMemory}. Sampling happens synchronously
 * around the (also synchronous) decoders, which is enough to catch the
 * large up-front allocation every one of them performs.
 */
export function observeDecodeMemory<T>(
  format: string,
  estimatedBytes: number,
  options: DecodeLimitOptions | undefined,
  decode: () => T,
): T {
  const onPeakMemory = options?.onPeakMemory;

  if (!onPeakMemory) {
    return decode();
  }

  const baseline = currentRss() ?? 0;
  let peak = baseline;
  let rejected = false;

  const sample = () => {
    const rss = currentRss();

    if (rss !== undefined && rss > peak) {
      peak = rss;
    }
  };

  try {
    const result = decode();

    sample();

    return result;
  } catch (error) {
    sample();
    rejected = error instanceof ImageLimitError;

    throw error;
  } finally {
    onPeakMemory({
      format,
      peakRssBytes: peak,
      baselineRssBytes: baseline,
      estimatedBytes,
      rejected,
    });
  }
}

/**
 * Thrown when the file itself cannot be parsed: truncated input, a bad
 * signature, an unsupported header, ... Callers should report this as a
 * corrupt/invalid file rather than a resource-limit rejection.
 */
export class ImageCorruptError extends Error {
  override readonly name = "ImageCorruptError";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown when a well-formed file declares dimensions or a memory footprint
 * that exceeds the configured decode limits. Callers should report this as
 * a policy rejection ("image too large"), distinct from corruption.
 */
export class ImageLimitError extends Error {
  override readonly name = "ImageLimitError";

  constructor(message: string) {
    super(message);
  }
}

function positiveInteger(value: number | undefined, fallback: number) {
  const resolved = value ?? fallback;

  if (
    typeof resolved !== "number" ||
    !Number.isFinite(resolved) ||
    resolved <= 0 ||
    !Number.isInteger(resolved)
  ) {
    throw new ImageCorruptError(
      `Invalid decode limit: expected a positive integer, got ${String(value)}`,
    );
  }

  return resolved;
}

/**
 * Merge per-decode options over the (possibly environment-configured)
 * defaults. Environment variables let operators tune the limits per machine
 * without touching code:
 *
 * - `JIMP_DECODE_MAX_WIDTH`
 * - `JIMP_DECODE_MAX_HEIGHT`
 * - `JIMP_DECODE_MAX_PIXELS`
 * - `JIMP_DECODE_MAX_MEMORY`
 */
export function resolveDecodeLimits(
  options?: DecodeLimitOptions,
  env: NodeJS.ProcessEnv = globalThis.process?.env ?? {},
): DecodeLimits {
  const fromEnv = (name: string) => {
    const raw = env[name];

    if (raw === undefined || raw === "") {
      return undefined;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      throw new ImageCorruptError(`Invalid decode limit in ${name}: ${raw}`);
    }

    return parsed;
  };

  const maxPixels = positiveInteger(
    options?.maxPixels ?? fromEnv("JIMP_DECODE_MAX_PIXELS"),
    DEFAULT_MAX_DECODE_PIXELS,
  );
  const maxMemory = positiveInteger(
    options?.maxMemory ?? fromEnv("JIMP_DECODE_MAX_MEMORY"),
    DEFAULT_MAX_DECODE_MEMORY,
  );
  const maxWidth = positiveInteger(
    options?.maxWidth ?? fromEnv("JIMP_DECODE_MAX_WIDTH"),
    maxPixels,
  );
  const maxHeight = positiveInteger(
    options?.maxHeight ?? fromEnv("JIMP_DECODE_MAX_HEIGHT"),
    maxPixels,
  );

  return { maxWidth, maxHeight, maxPixels, maxMemory };
}

/**
 * Guard called once the header has been parsed but before any pixel buffer
 * is allocated.
 *
 * @param width declared width
 * @param height declared height (use the absolute value for formats that
 *   encode the orientation in the height sign)
 * @param estimatedBytes conservative estimate of every buffer the decoder
 *   will allocate for this image
 */
export function assertDecodeLimits(
  limits: DecodeLimits,
  width: number,
  height: number,
  estimatedBytes: number,
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ImageCorruptError(
      `Invalid image dimensions in header: ${width}x${height}`,
    );
  }

  if (width > limits.maxWidth) {
    throw new ImageLimitError(
      `Image width ${width}px exceeds the decode limit of ${limits.maxWidth}px`,
    );
  }

  if (height > limits.maxHeight) {
    throw new ImageLimitError(
      `Image height ${height}px exceeds the decode limit of ${limits.maxHeight}px`,
    );
  }

  const pixels = safeMultiply(width, height);

  if (pixels > limits.maxPixels) {
    throw new ImageLimitError(
      `Image size ${width}x${height} (${pixels} pixels) exceeds the decode limit of ${limits.maxPixels} pixels`,
    );
  }

  if (!Number.isFinite(estimatedBytes) || estimatedBytes > limits.maxMemory) {
    throw new ImageLimitError(
      `Image decode needs an estimated ${estimatedBytes} bytes, exceeding the decode limit of ${limits.maxMemory} bytes`,
    );
  }
}

/**
 * Multiply two positive integers without silently overflowing to a wrong
 * (small) value, which would let a crafted header bypass the pixel check.
 */
export function safeMultiply(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
    return Number.POSITIVE_INFINITY;
  }

  const product = a * b;

  if (!Number.isFinite(product)) {
    return Number.POSITIVE_INFINITY;
  }

  return product;
}

/**
 * Conservative upper bound for the memory a decoder will touch while
 * producing a 4-byte RGBA bitmap. Covers the final RGBA buffer plus the
 * largest format-specific intermediate buffer.
 */
export function estimateDecodeBytes(
  width: number,
  height: number,
  intermediateBytesPerPixel: number,
): number {
  const pixels = safeMultiply(width, height);
  const rgba = safeMultiply(pixels, 4);
  const intermediate = safeMultiply(pixels, intermediateBytesPerPixel);

  return rgba + intermediate;
}

/** Read a uint32 little-endian field, throwing a corruption error when the
 * header is truncated instead of letting a RangeError escape. */
export function readUInt32LESafe(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new ImageCorruptError(
      `Truncated image header: expected 4 bytes at offset ${offset}, got ${buffer.length - offset}`,
    );
  }

  return buffer.readUInt32LE(offset);
}

/** Read a uint16 little-endian field with the same truncation protection. */
export function readUInt16LESafe(buffer: Buffer, offset: number): number {
  if (offset + 2 > buffer.length) {
    throw new ImageCorruptError(
      `Truncated image header: expected 2 bytes at offset ${offset}, got ${buffer.length - offset}`,
    );
  }

  return buffer.readUInt16LE(offset);
}

/** Read a uint32 big-endian field with the same truncation protection. */
export function readUInt32BESafe(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new ImageCorruptError(
      `Truncated image header: expected 4 bytes at offset ${offset}, got ${buffer.length - offset}`,
    );
  }

  return buffer.readUInt32BE(offset);
}

/** Read a single byte field with the same truncation protection. */
export function readUInt8Safe(buffer: Buffer, offset: number): number {
  if (offset + 1 > buffer.length) {
    throw new ImageCorruptError(`Truncated image header at offset ${offset}`);
  }

  return buffer.readUInt8(offset);
}
