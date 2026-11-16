<div align="center">
  <img width="200" height="200"
    src="https://s3.amazonaws.com/pix.iemoji.com/images/emoji/apple/ios-11/256/crayon.png">
  <h1>@jimp/bmp</h1>
  <p>Default Jimp bmp encoder/decoder.</p>
</div>

## Decode resource limits

The BMP header is validated against configurable limits **before** any pixel
buffer is allocated, so a few-hundred-byte file that declares gigapixel
dimensions is rejected without a large allocation.

- Defaults: 80,000,000 pixels and 1,600,000,000 bytes per decode.
- Tune per machine with environment variables
  `JIMP_DECODE_MAX_WIDTH`, `JIMP_DECODE_MAX_HEIGHT`,
  `JIMP_DECODE_MAX_PIXELS` and `JIMP_DECODE_MAX_MEMORY`, or per call with
  the `maxWidth`/`maxHeight`/`maxPixels`/`maxMemory` decode options.
- A valid image that exceeds a limit rejects with `ImageLimitError`; a
  truncated or malformed file rejects with `ImageCorruptError`. Both are
  exported from `@jimp/utils`.
- Pass `onPeakMemory(peak)` in the decode options to receive the peak RSS,
  up-front byte estimate and rejection flag for every decode (useful for
  load tests).
