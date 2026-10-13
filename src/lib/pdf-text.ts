/**
 * Read a degree-audit PDF in the browser.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export async function textFromPDF(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] ?? 0;
      if (lastY != null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = "";
      }
      if (line && item.str && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " ";
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
        lastY = null;
        continue;
      }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n");
}
