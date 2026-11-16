import {
  assertDecodeLimits,
  DecodeLimitOptions,
  ImageCorruptError,
  readUInt8Safe,
  readUInt32BESafe,
  resolveDecodeLimits,
  safeMultiply,
} from "@jimp/utils";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_LENGTH_OFFSET = 8;
const IHDR_TYPE_OFFSET = 12;
const IHDR_DATA_OFFSET = 16;
const IHDR_DATA_LENGTH = 13;
const IHDR_TYPE = "IHDR";

/** Channels per pixel for each PNG color type, matching pngjs bpp map. */
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // RGB
  3: 1, // indexed (palette)
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

const SUPPORTED_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);

export interface PngHeaderInfo {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
  /** Bytes per pixel (including padding) of the inflated scanline data. */
  rawBytesPerPixel: number;
}

/**
 * Parse the IHDR chunk directly from the file, before pngjs touches the
 * compressed image data. The same validation pngjs performs is replicated
 * here so unsupported/corrupt headers keep surfacing as corruption while
 * oversized-but-valid headers surface as limit errors.
 */
export function readPngHeader(data: Buffer): PngHeaderInfo {
  if (data.length < IHDR_DATA_OFFSET + IHDR_DATA_LENGTH) {
    throw new ImageCorruptError(
      `Truncated PNG file: expected at least ${IHDR_DATA_OFFSET + IHDR_DATA_LENGTH} bytes, got ${data.length}`,
    );
  }

  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ImageCorruptError("Invalid PNG signature");
  }

  const chunkLength = readUInt32BESafe(data, IHDR_LENGTH_OFFSET);

  if (chunkLength < IHDR_DATA_LENGTH) {
    throw new ImageCorruptError(
      `Invalid PNG IHDR chunk length: ${chunkLength}`,
    );
  }

  if (
    data.toString("ascii", IHDR_TYPE_OFFSET, IHDR_TYPE_OFFSET + 4) !== IHDR_TYPE
  ) {
    throw new ImageCorruptError("Expected IHDR as the first PNG chunk");
  }

  const width = readUInt32BESafe(data, IHDR_DATA_OFFSET);
  const height = readUInt32BESafe(data, IHDR_DATA_OFFSET + 4);
  const depth = readUInt8Safe(data, IHDR_DATA_OFFSET + 8);
  const colorType = readUInt8Safe(data, IHDR_DATA_OFFSET + 9);
  const compression = readUInt8Safe(data, IHDR_DATA_OFFSET + 10);
  const filter = readUInt8Safe(data, IHDR_DATA_OFFSET + 11);
  const interlace = readUInt8Safe(data, IHDR_DATA_OFFSET + 12);

  if (!SUPPORTED_BIT_DEPTHS.has(depth)) {
    throw new ImageCorruptError(`Unsupported PNG bit depth ${depth}`);
  }

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];

  if (channels === undefined) {
    throw new ImageCorruptError(`Unsupported PNG color type ${colorType}`);
  }

  if (compression !== 0) {
    throw new ImageCorruptError(
      `Unsupported PNG compression method ${compression}`,
    );
  }

  if (filter !== 0) {
    throw new ImageCorruptError(`Unsupported PNG filter method ${filter}`);
  }

  if (interlace !== 0 && interlace !== 1) {
    throw new ImageCorruptError(
      `Unsupported PNG interlace method ${interlace}`,
    );
  }

  return {
    width,
    height,
    depth,
    colorType,
    interlace,
    rawBytesPerPixel: channels,
  };
}

/**
 * Conservative estimate of every sizable buffer pngjs builds:
 * - the inflated scanline data (`ceil(width * bpp * depth / 8) + 1` per row)
 * - the 16-bit intermediate `Uint16Array` when depth is 16
 * - the final 4-byte RGBA bitmap
 */
export function estimatePngDecodeBytes(header: PngHeaderInfo): number {
  const { width, height, depth, rawBytesPerPixel } = header;
  const rowSize =
    ((safeMultiply(width, rawBytesPerPixel) * depth + 7) >> 3) + 1;
  const inflatedBytes = safeMultiply(rowSize, height);
  const pixels = safeMultiply(width, height);
  const rgbaBytes = safeMultiply(pixels, 4);
  // depth === 16 keeps an 8-bytes-per-pixel Uint16Array alive alongside the
  // RGBA output during format normalisation.
  const deepBytes = depth === 16 ? safeMultiply(pixels, 8) : 0;

  return rgbaBytes + inflatedBytes + deepBytes;
}

export function guardPngDecode(
  data: Buffer,
  options?: DecodeLimitOptions,
): { header: PngHeaderInfo; estimatedBytes: number } {
  const header = readPngHeader(data);
  const limits = resolveDecodeLimits(options);
  const estimatedBytes = estimatePngDecodeBytes(header);

  assertDecodeLimits(limits, header.width, header.height, estimatedBytes);

  return { header, estimatedBytes };
}
