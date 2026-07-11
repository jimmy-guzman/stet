import { describe, expect, test } from "bun:test";

import { formatBytes } from "@/utils/format-bytes";

describe("formatBytes", () => {
  test("reports raw bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(945)).toBe("945 B");
  });

  test("keeps one fractional digit below 10", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(4608)).toBe("4.5 KB");
  });

  test("drops the fraction at 10 and above", () => {
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
});
