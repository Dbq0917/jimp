<div align="center">
  <img width="200" height="200"
    src="https://s3.amazonaws.com/pix.iemoji.com/images/emoji/apple/ios-11/256/crayon.png">
  <h1>@jimp/png</h1>
  <p>Default Jimp png encoder/decoder.</p>
</div>

## Decode resource limits

The IHDR chunk is validated against configurable limits **before** pngjs
inflates the image data or allocates a bitmap, so a tiny file that declares
gigapixel dimensions is rejected without a large allocation.

- Defaults: 80,000,000 pixels and 1,600,000,000 bytes per decode (the byte
  estimate covers the inflated scanlines, any 16-bit intermediate buffer and
  the final RGBA output).
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

## Available Methods

### Jimp.deflateLevel

Sets the deflate level used when saving as PNG format (default is 9)

### Jimp.deflateStrategy

Sets the deflate strategy used when saving as PNG format (default is 3)

### Jimp.filterType

Sets the filter type used when saving as PNG format (default is automatic filters)

### Jimp.colorType

Sets the color type used when saving as PNG format (one of 0, 2, 4, 6)

### Filter Types

```js
Jimp.PNG_FILTER_AUTO;
Jimp.PNG_FILTER_NONE;
Jimp.PNG_FILTER_SUB;
Jimp.PNG_FILTER_UP;
Jimp.PNG_FILTER_AVERAGE;
Jimp.PNG_FILTER_PATH;
```
