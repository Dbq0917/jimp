import { createJimp } from "@jimp/core";
import { expect, test, describe, afterEach } from "vitest";

import jpeg from "@jimp/js-jpeg";

import jxl, { JXL_MIME, resetJxlCodec, JxlError } from "./index.js";
import { setJxlCodecLoader } from "./codec.js";

const Jimp = createJimp({ formats: [jxl, jpeg] });

afterEach(() => {
  resetJxlCodec();
});

describe("when the optional JXL dependency is not installed", () => {
  test("the plugin can still be imported and registered", async () => {
    setJxlCodecLoader(async () => {
      throw new JxlError(
        "JXL_DECODER_MISSING",
        "Cannot find module 'rapier-jxl'"
      );
    });

    const instance = new Jimp({ width: 2, height: 2 });
    const registered = instance.formats.some(
      (format) => format.mime === JXL_MIME
    );
    expect(registered).toBe(true);
  });

  test("reading a JXL file reports the missing decoder, not corruption", async () => {
    setJxlCodecLoader(async () => {
      throw new JxlError(
        "JXL_DECODER_MISSING",
        "Cannot find module 'rapier-jxl'"
      );
    });

    const file = Buffer.from([0xff, 0x0a, 1, 2, 3, 4, 5, 6]);

    try {
      await Jimp.fromBuffer(file);
      throw new Error("expected fromBuffer to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JxlError);
      expect((error as JxlError).code).toBe("JXL_DECODER_MISSING");
    }
  });

  test("jpeg processing keeps working normally", async () => {
    setJxlCodecLoader(async () => {
      throw new JxlError(
        "JXL_DECODER_MISSING",
        "Cannot find module 'rapier-jxl'"
      );
    });

    const image = new Jimp({ width: 4, height: 4, color: 0xff112233 });
    const jpegBuffer = await image.getBuffer("image/jpeg", { quality: 90 });
    expect(jpegBuffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const reRead = await Jimp.fromBuffer(jpegBuffer);
    expect(reRead.mime).toBe("image/jpeg");
    expect(reRead.bitmap.width).toBe(4);
  });
});
