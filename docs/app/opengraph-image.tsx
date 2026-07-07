import { ImageResponse } from "next/og";

export const alt = "stet: read-only companion TUI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        backgroundColor: "#101214",
        fontFamily: "monospace",
      }}
    >
      <div style={{ display: "flex", fontSize: 200, fontWeight: 700, color: "#ffa7d9" }}>stet</div>
      <div style={{ display: "flex", marginTop: 8, fontSize: 44, color: "#e9ebee" }}>
        read-only companion TUI
      </div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: "#848688" }}>
        Inspect an agent's changes as they happen.
      </div>
    </div>,
    size,
  );
}
