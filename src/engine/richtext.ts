// Text formatting — faithful port of the original control-code scheme
// (artifacts/inc/format.h + format.cpp SzSkipOneFormat):
//   0x02 bold toggle, 0x03 color (^c<fg>[,<bg>], values %16), 0x0C link,
//   0x11 fixed pitch toggle, 0x12 symbol toggle, 0x16 italic toggle,
//   0x1F underline toggle.

export const CH_BOLD = '\x02';
export const CH_COLOR = '\x03';
export const CH_LINK = '\x0C';
export const CH_FIXED = '\x11';
export const CH_SYMBOL = '\x12';
export const CH_ITALIC = '\x16';
export const CH_UNDERLINE = '\x1F';

/** colordlg.h clrTable — the authentic 16-color palette. */
export const FORMAT_COLORS: string[] = [
  'rgb(0,0,0)',
  'rgb(128,0,0)',
  'rgb(0,128,0)',
  'rgb(128,128,0)',
  'rgb(0,0,128)',
  'rgb(128,0,128)',
  'rgb(0,128,128)',
  'rgb(128,128,128)',
  'rgb(192,192,192)',
  'rgb(255,0,0)',
  'rgb(0,255,0)',
  'rgb(255,255,0)',
  'rgb(0,0,255)',
  'rgb(255,0,255)',
  'rgb(0,255,255)',
  'rgb(255,255,255)',
];

export interface CharFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fixed: boolean;
  symbol: boolean;
  color: number | null; // index into FORMAT_COLORS
}

export const DEFAULT_FORMAT: CharFormat = {
  bold: false,
  italic: false,
  underline: false,
  fixed: false,
  symbol: false,
  color: null,
};

export interface TextSegment {
  text: string;
  fmt: CharFormat;
}

export function sameFormat(a: CharFormat, b: CharFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.fixed === b.fixed &&
    a.symbol === b.symbol &&
    a.color === b.color
  );
}

/** Parse control codes into styled segments (SzSkipOneFormat semantics). */
export function parseFormatted(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const fmt: CharFormat = { ...DEFAULT_FORMAT };
  let buf = '';

  const flush = () => {
    if (buf) {
      segments.push({ text: buf, fmt: { ...fmt } });
      buf = '';
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    switch (ch) {
      case CH_BOLD:
        flush();
        fmt.bold = !fmt.bold;
        break;
      case CH_ITALIC:
        flush();
        fmt.italic = !fmt.italic;
        break;
      case CH_UNDERLINE:
        flush();
        fmt.underline = !fmt.underline;
        break;
      case CH_FIXED:
        flush();
        fmt.fixed = !fmt.fixed;
        break;
      case CH_SYMBOL:
        flush();
        fmt.symbol = !fmt.symbol;
        break;
      case CH_LINK:
        flush();
        break; // links: styling only in the original
      case CH_COLOR: {
        flush();
        // ^c<d>[<d>][,<d>[<d>]] — bare ^c resets to default
        let j = i + 1;
        let fg = '';
        let bg = '';
        while (j < input.length && fg.length < 2 && input[j] >= '0' && input[j] <= '9')
          fg += input[j++];
        if (input[j] === ',') {
          j++;
          while (j < input.length && bg.length < 2 && input[j] >= '0' && input[j] <= '9')
            bg += input[j++];
        }
        fmt.color = fg ? parseInt(fg, 10) % 16 : null;
        i = j - 1;
        break;
      }
      default:
        if (ch >= ' ' || ch === '\t') buf += ch;
        break;
    }
  }
  flush();
  return segments.length ? segments : [{ text: '', fmt: { ...DEFAULT_FORMAT } }];
}

/** Strip all control codes (for semantics, previews, plain IRC display). */
export function stripFormatting(input: string): string {
  return parseFormatted(input)
    .map((s) => s.text)
    .join('');
}

/** Encode a whole message with a uniform format (what the toolbar toggles
 *  produce — the original prefixes the codes when sending). */
export function encodeFormatted(text: string, fmt: CharFormat): string {
  let prefix = '';
  if (fmt.color !== null) prefix += `${CH_COLOR}${fmt.color}`;
  if (fmt.bold) prefix += CH_BOLD;
  if (fmt.italic) prefix += CH_ITALIC;
  if (fmt.underline) prefix += CH_UNDERLINE;
  if (fmt.fixed) prefix += CH_FIXED;
  if (fmt.symbol) prefix += CH_SYMBOL;
  return prefix ? prefix + text : text;
}

/** Does the message text contain any formatting codes? */
export function hasFormatting(input: string): boolean {
  return /[\x02\x03\x0C\x11\x12\x16\x1F]/.test(input);
}

// Symbol-font transliteration (the classic Adobe Symbol layout): letters map
// to Greek so 0x12 formatting looks like the original Symbol font output.
const SYMBOL_UPPER = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';

export function symbolize(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') out += SYMBOL_UPPER[ch.charCodeAt(0) - 65];
    else if (ch >= 'a' && ch <= 'z') out += SYMBOL_LOWER[ch.charCodeAt(0) - 97];
    else out += ch;
  }
  return out;
}
