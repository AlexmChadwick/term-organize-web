/**
 * Read a degree-audit PDF in the browser.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

interface PdfTextItem {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: unknown[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage: (number: number) => Promise<PdfPage>;
  cleanup: () => Promise<void>;
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: Uint8Array; standardFontDataUrl?: string }) => { promise: Promise<PdfDocument> };
}

export async function textFromPDF(data: ArrayBuffer | Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  const standardFontDataUrl =
    typeof window === "undefined" ? `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` : `${window.location.origin}/standard_fonts/`;
  const doc = await pdfjs.getDocument({ data: bytes, standardFontDataUrl }).promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(pageText(content.items));
    }
    return pages.join("\n");
  } finally {
    await doc.cleanup();
  }
}

/**
 * Reading order: top to bottom, then left to right. A dash bullet drawn to the
 * left of a line stays a prefix (PDFKit sometimes glues it on), which the
 * plan parser already strips.
 */
function pageText(items: unknown[]): string {
  const glyphs: { str: string; x: number; y: number; hasEOL: boolean }[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const text = item as PdfTextItem;
    glyphs.push({
      str: text.str,
      x: text.transform?.[4] ?? 0,
      y: text.transform?.[5] ?? 0,
      hasEOL: text.hasEOL === true,
    });
  }
  glyphs.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 2) return dy;
    return a.x - b.x;
  });
  const lines: string[] = [];
  let line = "";
  let lastY: number | null = null;
  for (const glyph of glyphs) {
    if (lastY != null && Math.abs(glyph.y - lastY) > 2) {
      lines.push(line);
      line = "";
    }
    if (line && glyph.str && !line.endsWith(" ") && !glyph.str.startsWith(" ")) line += " ";
    line += glyph.str;
    if (glyph.hasEOL) {
      lines.push(line);
      line = "";
      lastY = null;
      continue;
    }
    lastY = glyph.y;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

async function loadPdfjs(): Promise<PdfjsModule> {
  if (typeof window !== "undefined") {
    const pdfjs = (await import("pdfjs-dist")) as unknown as PdfjsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  }
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as unknown as PdfjsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = `file://${process.cwd()}/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`;
  return pdfjs;
}
