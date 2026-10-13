/**
 * Degree-plan PDF in the audit's View Plan layout.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreePlanPDF.swift: A4, Helvetica 12 pt,
 * 18 pt line spacing, baselines from 54 to 774, dash bullets 30 pt left of
 * section and course lines.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DegreePlan } from "./requirements";
import { bodyLines, headerLines } from "./degree-format";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LINE = 18;
const FIRST_BASELINE = 54;
const LAST_BASELINE = 774;
const INDENT_X = [36, 96, 126];

export async function renderDegreePlanPDF(plan: DegreePlan, printedAt = new Date(), includeStudent = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Degree Audit Plan – ${plan.name}`);
  doc.setCreator("Term Organize");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const header = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const blank = { indent: 0, text: " ", header: false };
  const lines = [
    blank,
    blank,
    ...headerLines(plan, printedAt, includeStudent).map((text) => ({ indent: 0, text, header: true })),
    ...bodyLines(plan).map((line) => ({ indent: line.indent, text: line.text, header: false })),
    blank,
    blank,
  ];
  const lastVisible = lines.findLastIndex((line) => line.text !== " ");
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let baseline = FIRST_BASELINE;
  let open = true;
  lines.forEach((line, index) => {
    if (baseline > LAST_BASELINE) {
      if (index > lastVisible) return;
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      baseline = FIRST_BASELINE;
      open = true;
    }
    if (!open) return;
    const shown = line.text.replaceAll("\t", " ");
    const font = line.header ? header : regular;
    const x = INDENT_X[line.indent] ?? 36;
    if (shown.trim()) {
      page.drawText(shown, { x, y: PAGE_HEIGHT - baseline, size: 12, font, color: rgb(0, 0, 0) });
    }
    if (line.indent > 0) {
      page.drawText("-", { x: x - 30, y: PAGE_HEIGHT - baseline, size: 12, font: regular, color: rgb(0, 0, 0) });
    }
    baseline += LINE;
  });
  return doc.save();
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
