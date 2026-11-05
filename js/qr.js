// QR drawing. The encoder is the vendored MIT uqr build. No remote image host.

import { encode } from "../vendor/uqr.js";

export function qrElement(text) {
  const result = encode(String(text || ""), { ecc: "M", border: 2 });
  const pixel = 8;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const size = result.size * pixel;
  svg.setAttribute("class", "qr-code");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for this Solana address");
  const bg = document.createElementNS(svg.namespaceURI, "rect");
  bg.setAttribute("width", String(size));
  bg.setAttribute("height", String(size));
  bg.setAttribute("fill", "#fff8e8");
  svg.append(bg);
  for (let row = 0; row < result.size; row += 1) {
    for (let col = 0; col < result.size; col += 1) {
      if (!result.data[row][col]) continue;
      const cell = document.createElementNS(svg.namespaceURI, "rect");
      cell.setAttribute("x", String(col * pixel));
      cell.setAttribute("y", String(row * pixel));
      cell.setAttribute("width", String(pixel));
      cell.setAttribute("height", String(pixel));
      cell.setAttribute("fill", "#1a1204");
      svg.append(cell);
    }
  }
  return svg;
}
