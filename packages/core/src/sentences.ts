/**
 * Deterministic sentence splitter with exact character offsets.
 *
 * Avoids false splits on common English and Spanish abbreviations (`e.g.`,
 * `i.e.`, `p. ej.`, `etc.`, `Dr.`, `Sr.`, `v0.1.1`, decimals, single-letter
 * initials, and ellipses before lowercase text).
 */

export interface SentenceSpan {
  text: string;
  /** Inclusive start offset in the input string */
  start: number;
  /** Exclusive end offset in the input string */
  end: number;
  /** Zero-based sentence index */
  index: number;
}

/**
 * Lowercased abbreviations (without trailing dot) that should not end a
 * sentence when followed by whitespace.
 */
const ABBREVIATIONS = new Set([
  // English titles & honorifics
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'rev', 'gen', 'col', 'lt', 'sgt', 'capt',
  // English scholarly / technical / business
  'eg', 'ie', 'etc', 'vs', 'al', 'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'ed', 'eds',
  'inc', 'ltd', 'corp', 'co', 'dept', 'est', 'approx', 'min', 'max', 'ref', 'refs', 'sec', 'ch',
  // Months (EN)
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  // Spanish titles & honorifics
  'sra', 'srta', 'dra', 'ud', 'uds', 'vd', 'vds', 'd', 'dña', 'lic', 'ing', 'arq',
  // Spanish scholarly / legal / technical
  'ej', 'p', 'art', 'arts', 'cap', 'pág', 'págs', 'pag', 'pags', 'núm', 'num', 'tel',
  'aprox', 'dpto', 'depto', 'dir', 'adm', 'gral', 'av', 'avda', 'cía', 'cia', 's.a', 's.l',
]);

/** True if the period at `dotIndex` looks like part of an abbreviation or non-terminal token. */
function isNonTerminalPeriod(text: string, dotIndex: number, afterWsIndex: number): boolean {
  if (text[dotIndex] !== '.') return false;

  // Ellipsis ("..." or "..") followed by a lowercase letter does not split.
  if (dotIndex > 0 && text[dotIndex - 1] === '.') {
    const nextChar = text[afterWsIndex];
    if (nextChar && /^[a-záéíóúüñ]/.test(nextChar)) return true;
    return false;
  }

  // Extract the non-whitespace token immediately ending at dotIndex.
  let tokenStart = dotIndex;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) {
    tokenStart--;
  }
  const token = text.slice(tokenStart, dotIndex + 1);
  // Strip leading punctuation/quotes/parens from the token.
  const stripped = token.replace(/^["'«“‘([]+/, '');

  // Version numbers or dotted numbers like "v0.1.1." or "1.2." followed by lowercase
  if (/^v?\d+(?:\.\d+)+\.$/.test(stripped)) {
    const nextChar = text[afterWsIndex];
    if (nextChar && /^[a-záéíóúüñ0-9]/.test(nextChar)) return true;
  }

  // Dotted multi-part abbreviations like "e.g.", "i.e.", "U.S.A.", "S.A.", "p.ej."
  if (/^(?:[a-zA-Záéíóúüñ]{1,3}\.){2,}$/.test(stripped)) {
    // Allow splitting only if the next word starts with an uppercase letter AND
    // the abbreviation is not "e.g." / "i.e." / "p.ej." (which introduce examples).
    const lower = stripped.toLowerCase();
    if (lower === 'e.g.' || lower === 'i.e.' || lower === 'p.ej.') return true;
    const nextChar = text[afterWsIndex];
    if (!nextChar || /^[a-záéíóúüñ0-9"'([]/.test(nextChar)) return true;
    return false;
  }

  // Single-letter initial like "J." in "J. K. Rowling" or "p." in "p. ej."
  if (/^[a-zA-Záéíóúüñ]\.$/.test(stripped)) {
    // "p. ej." -> "p." followed by "ej."
    const rest = text.slice(afterWsIndex);
    if (/^ej\./i.test(rest)) return true;
    // Initial followed by another initial or capitalized surname
    if (/^[A-ZÁÉÍÓÚÜÑ]/.test(stripped) && /^[A-ZÁÉÍÓÚÜÑ]/.test(rest)) return true;
  }

  // Known abbreviation list (strip trailing dot).
  const base = stripped.slice(0, -1).toLowerCase();
  if (ABBREVIATIONS.has(base)) {
    // For "etc." followed by a Capitalized word, it likely ended the sentence.
    if (base === 'etc') {
      const nextChar = text[afterWsIndex];
      return Boolean(nextChar && /^[a-záéíóúüñ,;)]/.test(nextChar));
    }
    return true;
  }

  return false;
}

/**
 * Splits `text` into trimmed sentence spans with exact `[start, end)` offsets.
 */
export function splitSentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundaryRe = /([.!?]+)(\s+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushTrimmed = (rawStart: number, rawEnd: number) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) {
      spans.push({
        text: text.slice(start, end),
        start,
        end,
        index: spans.length,
      });
    }
  };

  while ((match = boundaryRe.exec(text)) !== null) {
    const punct = match[1];
    const ws = match[2];
    const punctEnd = match.index + punct.length;
    const afterWs = punctEnd + ws.length;

    // Only check abbreviation rules when the terminator is a period (not ! or ?).
    if (punct.endsWith('.') && !/[!?]/.test(punct)) {
      if (isNonTerminalPeriod(text, punctEnd - 1, afterWs)) {
        continue;
      }
    }

    pushTrimmed(cursor, punctEnd);
    cursor = afterWs;
  }

  pushTrimmed(cursor, text.length);
  return spans;
}
