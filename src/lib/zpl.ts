/**
 * Zebra label printing (ZPL II) for the roll labels and bundle slips, for a factory that prints on a thermal label printer instead of A4.
 * One small text file; the printer's own software (or a copy to the printer's share) prints it. No dependency, no driver.
 *
 * Built to the ZPL II specification and checked by tests on its text; it has NOT yet been run on a printer (the model is not chosen), which
 * the screens say. A TSC printer needs a TSPL file instead; that is a separate small generator.
 *
 * Text is plain ASCII: a Zebra's built-in fonts have no Devanagari, so anything else becomes a question mark rather than a wrong glyph, and
 * the characters ZPL reserves (^ ~ \) are replaced so a name can never become a command.
 */
export type ZplLabel = {
  /** The large first line: the roll or bundle number. */
  title: string;
  /** Up to three smaller lines under it. */
  lines: string[];
  /** What the QR code opens. */
  qr: string;
};

/** The label stock: width and height in millimetres, and the printer's dots per millimetre (8 for a 203 dpi printer, 12 for 300 dpi). */
export type ZplStock = { widthMm: number; heightMm: number; dotsPerMm: number };
export const ZPL_50X30: ZplStock = { widthMm: 50, heightMm: 30, dotsPerMm: 8 };

/** Plain, single-line ASCII with ZPL's command characters removed. */
export const zplText = (value: string, max = 40): string =>
  value.replace(/[\^~\\\r\n\t]+/g, " ").replace(/[^\x20-\x7E]/g, "?").replace(/\s+/g, " ").trim().slice(0, max);

/** One label: the title and lines on the left, the QR on the right. */
export function zplLabel(label: ZplLabel, stock: ZplStock = ZPL_50X30): string {
  const w = Math.round(stock.widthMm * stock.dotsPerMm);
  const h = Math.round(stock.heightMm * stock.dotsPerMm);
  const margin = Math.round(2.5 * stock.dotsPerMm);
  const qrSide = Math.min(Math.round(h * 0.62), Math.round(w * 0.38));
  // Magnification: whole dots per module; QR version for a short URL is about 29 modules wide, so this keeps the code inside qrSide.
  const mag = Math.max(2, Math.floor(qrSide / 33));
  const textWidth = w - qrSide - margin * 3;
  const big = Math.round(h * 0.2);
  const small = Math.round(h * 0.1);
  const out = [
    "^XA",
    `^PW${w}`,
    `^LL${h}`,
    "^LH0,0",
    `^FO${margin},${margin}^A0N,${big},${big}^FB${textWidth},1,0,L,0^FD${zplText(label.title, 14)}^FS`,
  ];
  label.lines.slice(0, 3).forEach((line, i) => {
    out.push(`^FO${margin},${margin + big + Math.round(small * 0.8) + i * Math.round(small * 1.4)}^A0N,${small},${small}^FB${textWidth},1,0,L,0^FD${zplText(line, 30)}^FS`);
  });
  out.push(`^FO${w - qrSide - margin},${margin}^BQN,2,${mag}^FDMA,${zplText(label.qr, 200)}^FS`, "^XZ");
  return out.join("\n");
}

/** A file with one label per piece of stock, ready to send to the printer. */
export const zplFile = (labels: ZplLabel[], stock: ZplStock = ZPL_50X30): string => labels.map((l) => zplLabel(l, stock)).join("\n") + "\n";
