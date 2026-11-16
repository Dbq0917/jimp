import {
  assertDecodeLimits,
  DecodeLimitOptions,
  estimateDecodeBytes,
  ImageCorruptError,
  readUInt16LESafe,
  readUInt32LESafe,
  resolveDecodeLimits,
} from "@jimp/utils";

export interface BmpHeaderInfo {
  width: number;
  /** Always positive; the sign of the raw field only carries orientation. */
  height: number;
  bitPP: number;
  headerSize: number;
}

const BMP_SIGNATURE = "BM";
const BITMAP_FILE_HEADER_SIZE = 14;
/** File header (14) plus the BITMAPINFOHEADER fields up to bits-per-pixel. */
const MIN_BMP_HEADER_SIZE = BITMAP_FILE_HEADER_SIZE + 16;

/**
 * Parse just enough of the BMP header to validate the declared dimensions
 * against the decode limits. Runs before bmp-ts allocates its pixel buffer,
 * so a 200-byte file claiming gigapixel dimensions is rejected without any
 * large allocation taking place.
 */
export function readBmpHeader(data: Buffer): BmpHeaderInfo {
  if (data.length < MIN_BMP_HEADER_SIZE) {
    throw new ImageCorruptError(
      `Truncated BMP file: expected at least ${MIN_BMP_HEADER_SIZE} bytes, got ${data.length}`,
    );
  }

  if (data.toString("utf-8", 0, 2) !== BMP_SIGNATURE) {
    throw new ImageCorruptError("Invalid BMP signature: expected 'BM'");
  }

  const headerSize = readUInt32LESafe(data, BITMAP_FILE_HEADER_SIZE);
  const width = readUInt32LESafe(data, BITMAP_FILE_HEADER_SIZE + 4);
  const rawHeight = readUInt32LESafe(data, BITMAP_FILE_HEADER_SIZE + 8);

  // bmp-ts converts values above 0x7fffffff to a signed 32-bit integer; a
  // negative height only flips the row order, the pixel count is identical.
  const signedHeight =
    rawHeight > 0x7fffffff ? rawHeight - 0x100000000 : rawHeight;
  const height = Math.abs(signedHeight);

  const bitPP = readUInt16LESafe(data, BITMAP_FILE_HEADER_SIZE + 14);

  if (bitPP === 0) {
    throw new ImageCorruptError("Invalid BMP header: bits per pixel is 0");
  }

  return { width, height, bitPP, headerSize };
}

/**
 * bmp-ts always expands the image into a 4-byte-per-pixel RGBA buffer
 * (`Buffer.alloc(width * height * 4)`) and works in place, so the only
 * sizable allocation is the RGBA bitmap itself.
 */
export function guardBmpDecode(
  data: Buffer,
  options?: DecodeLimitOptions,
): BmpHeaderInfo {
  const header = readBmpHeader(data);
  const limits = resolveDecodeLimits(options);
  const estimatedBytes = estimateDecodeBytes(header.width, header.height, 0);

  assertDecodeLimits(limits, header.width, header.height, estimatedBytes);

  return header;
}
