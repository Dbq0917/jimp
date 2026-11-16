import { describe, expect, test } from "vitest";

import { isJxlError, JxlError, toDecodeError } from "./errors.js";

describe("JxlError", () => {
  test("keeps a stable code and is an Error instance", () => {
    const error = new JxlError("JXL_DECODE_FAILED", "bad file");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("JxlError");
    expect(error.code).toBe("JXL_DECODE_FAILED");
    expect(isJxlError(error)).toBe(true);
  });

  test("maps codec bitstream errors to JXL_DECODE_FAILED", () => {
    const codecError = Object.assign(new Error("Invalid signature"), {
      code: "JXL_DECODE",
    });
    const mapped = toDecodeError(codecError);
    expect(mapped.code).toBe("JXL_DECODE_FAILED");
    expect(mapped.cause).toBe(codecError);
  });

  test("maps environment errors to JXL_DECODER_MISSING", () => {
    const wasmError = Object.assign(new Error("SIMD unavailable"), {
      code: "JXL_WASM",
    });
    const mapped = toDecodeError(wasmError);
    expect(mapped.code).toBe("JXL_DECODER_MISSING");
  });

  test("passes existing JxlError instances through unchanged", () => {
    const original = new JxlError("JXL_ENCODE_FAILED", "nope");
    expect(toDecodeError(original)).toBe(original);
  });
});
