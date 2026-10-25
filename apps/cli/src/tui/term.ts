import { cellWidth, cleanText } from '../view.ts';

/** RGB plus the nearest xterm-256 index for terminals without truecolor. */
type Color = readonly [number, number, number, number];
export const palette = {
  bg: [13, 17, 26, 234],
  raised: [20, 26, 38, 235],
  text: [214, 220, 230, 253],
  dim: [118, 130, 150, 245],
  border: [50, 60, 80, 238],
  avt: [222, 32, 40, 160],
  red: [240, 84, 84, 203],
  cyan: [84, 210, 232, 80],
  green: [80, 196, 124, 78],
  yellow: [232, 196, 80, 221],
  addBg: [20, 54, 34, 22],
  delBg: [64, 22, 26, 52],
  selBg: [22, 42, 56, 23],
} as const satisfies Record<string, Color>;
export type Tone = keyof typeof palette;
export interface Style {
  fg?: Tone;
  bg?: Tone;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

const env = process.env;
/** 0 honours NO_COLOR/dumb terminals: attributes and symbols still carry meaning. */
export const colorDepth =
  env.NO_COLOR || env.TERM === 'dumb'
    ? 0
    : /truecolor|24bit/i.test(env.COLORTERM ?? '')
      ? 24
      : 8;
const sgrCache = new Map<string, string>();
export function sgr(style: Style, depth = colorDepth): string {
  const key = JSON.stringify(style) + depth;
  let value = sgrCache.get(key);
  if (value === undefined) {
    const codes = ['0'];
    if (style.bold) codes.push('1');
    if (style.dim) codes.push('2');
    if (style.underline) codes.push('4');
    if (style.inverse) codes.push('7');
    const color = (tone: Tone | undefined, base: number): void => {
      if (!tone || depth === 0) return;
      const [r, g, b, index] = palette[tone];
      codes.push(
        depth === 24 ? `${base};2;${r};${g};${b}` : `${base};5;${index}`,
      );
    };
    color(style.fg ?? 'text', 38);
    color(style.bg ?? 'bg', 48);
    value = `\u001b[${codes.join(';')}m`;
    sgrCache.set(key, value);
  }
  return value;
}

const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
export function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}
export function textWidth(value: string): number {
  let width = 0;
  for (const part of graphemes(value)) width += cellWidth(part);
  return width;
}
/** Single visual line: controls and secrets are removed before any measurement. */
export function flat(value: string): string {
  return cleanText(value.replaceAll('\t', '  '));
}
/** Word wrap by terminal columns, keeping explicit newlines. */
export function wrap(value: string, width: number, limit = Infinity): string[] {
  const lines: string[] = [];
  for (const paragraph of cleanText(value.replaceAll('\t', '  '), true).split(
    '\n',
  )) {
    let line = '',
      used = 0,
      lastSpace = -1;
    for (const part of graphemes(paragraph)) {
      const size = cellWidth(part);
      if (used + size > width && line) {
        if (lastSpace > 0 && part !== ' ') {
          lines.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1);
          used = textWidth(line);
        } else {
          lines.push(line);
          line = '';
          used = 0;
        }
        lastSpace = -1;
        if (part === ' ') continue;
        if (lines.length >= limit) return lines;
      }
      if (part === ' ') lastSpace = line.length;
      line += part;
      used += size;
    }
    lines.push(line);
    if (lines.length >= limit) return lines.slice(0, limit);
  }
  return lines;
}

interface Cell {
  ch: string;
  st: string;
}
export type Span = readonly [text: string, style: Style];
/** Cell grid: every view draws into regions, then the whole frame is diffed by line. */
export class Canvas {
  readonly rows: Cell[][];
  readonly base: string;
  constructor(
    readonly width: number,
    readonly height: number,
    base: Style = {},
  ) {
    this.base = sgr(base);
    this.rows = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ch: ' ', st: this.base })),
    );
  }
  private set(x: number, y: number, ch: string, st: string, wide: boolean) {
    const row = this.rows[y];
    if (!row || x < 0 || x >= this.width) return;
    if (row[x]!.ch === '' && x > 0)
      row[x - 1] = { ch: ' ', st: row[x - 1]!.st };
    if (row[x + 1]?.ch === '') row[x + 1] = { ch: ' ', st: row[x + 1]!.st };
    row[x] = { ch, st };
    if (wide && x + 1 < this.width) {
      if (row[x + 2]?.ch === '') row[x + 2] = { ch: ' ', st };
      row[x + 1] = { ch: '', st };
    }
  }
  /** Writes clipped text and returns the next column; `raw` keeps the user's own draft verbatim. */
  text(
    x: number,
    y: number,
    value: string,
    style: Style = {},
    end = this.width,
    raw = false,
  ) {
    const st = sgr(style);
    const start = x;
    for (const part of graphemes(raw ? value : flat(value))) {
      const size = cellWidth(part);
      if (x + size > end) {
        if (end > start) this.set(end - 1, y, '…', st, false);
        return end;
      }
      this.set(x, y, part, st, size === 2);
      x += size;
    }
    return x;
  }
  spans(x: number, y: number, parts: readonly Span[], end = this.width) {
    for (const [value, style] of parts) x = this.text(x, y, value, style, end);
    return x;
  }
  fill(x: number, y: number, w: number, h: number, style: Style = {}) {
    const st = sgr(style);
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++) this.set(col, row, ' ', st, false);
  }
  /** Thin rounded border, heavy border when selected so the focus survives NO_COLOR. */
  box(
    x: number,
    y: number,
    w: number,
    h: number,
    options: {
      style?: Style;
      heavy?: boolean;
      title?: readonly Span[];
      right?: readonly Span[];
      footer?: readonly Span[];
      footerRight?: readonly Span[];
    } = {},
  ) {
    if (w < 2 || h < 2) return;
    const line = options.style ?? { fg: 'border' };
    const [tl, tr, bl, br, hz, vt] = options.heavy
      ? ['┏', '┓', '┗', '┛', '━', '┃']
      : ['╭', '╮', '╰', '╯', '─', '│'];
    this.text(x, y, tl + hz.repeat(w - 2) + tr, line);
    this.text(x, y + h - 1, bl + hz.repeat(w - 2) + br, line);
    for (let row = y + 1; row < y + h - 1; row++) {
      this.text(x, row, vt, line);
      this.text(x + w - 1, row, vt, line);
    }
    // Right labels are placed first, after the left label; left labels are clipped before them.
    const widthOf = (parts: readonly Span[] | undefined) =>
      (parts ?? []).reduce((sum, [text]) => sum + textWidth(flat(text)), 0);
    let floor = x + 2;
    const label = (
      parts: readonly Span[] | undefined,
      row: number,
      right: boolean,
      limit = x + w - 2,
    ): number => {
      if (!parts?.length) return limit;
      const width = parts.reduce(
        (sum, [text]) => sum + textWidth(flat(text)),
        0,
      );
      const start = right ? Math.max(floor, x + w - 3 - width) : x + 2;
      if (start >= limit) return limit;
      this.text(start - 1, row, ' ', line);
      const after = this.spans(start, row, parts, limit - 1);
      this.text(after, row, ' ', line, limit);
      return start - 2;
    };
    floor = Math.min(x + w - 4, x + 4 + widthOf(options.title));
    label(options.title, y, false, label(options.right, y, true));
    floor = Math.min(
      x + w - 4,
      x + 4 + Math.min(widthOf(options.footer), Math.floor(w / 2)),
    );
    label(
      options.footer,
      y + h - 1,
      false,
      label(options.footerRight, y + h - 1, true),
    );
  }
  lines(): string[] {
    return this.rows.map((row) => {
      let out = '',
        current = '';
      for (const cell of row) {
        if (cell.ch === '') continue;
        if (cell.st !== current) out += current = cell.st;
        out += cell.ch;
      }
      return out + '\u001b[0m';
    });
  }
  /** Plain text for tests and logs. */
  plain(): string[] {
    return this.rows.map((row) =>
      row
        .map((cell) => cell.ch)
        .join('')
        .trimEnd(),
    );
  }
}

/** Alternate screen with line-level diffing to avoid flicker and cursor jumps. */
export class Screen {
  private previous: string[] = [];
  constructor(private readonly out: NodeJS.WriteStream) {}
  enter(): void {
    this.out.write(
      '\u001b[?1049h\u001b[?7l\u001b[?2004h\u001b[?25l\u001b[H\u001b[2J',
    );
  }
  leave(): void {
    this.out.write('\u001b[0m\u001b[?2004l\u001b[?7h\u001b[?25h\u001b[?1049l');
  }
  invalidate(): void {
    this.previous = [];
    this.out.write('\u001b[0m\u001b[2J');
  }
  draw(lines: string[], cursor: { x: number; y: number } | null): void {
    let chunk = '\u001b[?2026h\u001b[?25l';
    lines.forEach((line, index) => {
      if (this.previous[index] !== line)
        chunk += `\u001b[${index + 1};1H${line}`;
    });
    if (cursor) chunk += `\u001b[${cursor.y + 1};${cursor.x + 1}H\u001b[?25h`;
    this.out.write(chunk + '\u001b[?2026l');
    this.previous = lines;
  }
}
