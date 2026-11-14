import { describe, expect, test } from "bun:test";

import type { RenderDiffFilesResult } from "@pierre/diffs";

import { flattenLineSpans } from "@/diff/hast";

type HastNode = RenderDiffFilesResult["additionLines"][number];

const text = (value: string): HastNode => ({ type: "text", value });

const element = (children: HastNode[], style?: string): HastNode => ({
  children,
  properties: style === undefined ? {} : { style },
  tagName: style === undefined ? "div" : "span",
  type: "element",
});

const span = (color: string, value: string) =>
  element([text(value)], `color:${color}`);

describe("flattenLineSpans", () => {
  test("flattens a line div of colored token spans into ordered spans", () => {
    const line = element([span("#F97583", "const"), span("#79B8FF", " b")]);

    expect(flattenLineSpans(line)).toEqual([
      { fg: "#F97583", text: "const" },
      { fg: "#79B8FF", text: " b" },
    ]);
  });

  test("inherits color from an ancestor span when a child has none", () => {
    const line = element([element([text("nested")], "color:#abcdef")]);

    expect(flattenLineSpans(line)).toEqual([{ fg: "#abcdef", text: "nested" }]);
  });

  test("emits an uncolored span for plain text without a color style", () => {
    const line = element([text("plain")]);

    expect(flattenLineSpans(line)).toEqual([{ text: "plain" }]);
  });

  test("strips a trailing newline from the final span", () => {
    const line = element([span("#fff", "end\n")]);

    expect(flattenLineSpans(line)).toEqual([{ fg: "#fff", text: "end" }]);
  });

  test("returns no spans for a missing or empty line node", () => {
    expect(flattenLineSpans(undefined)).toEqual([]);
    expect(flattenLineSpans(element([]))).toEqual([]);
  });
});
