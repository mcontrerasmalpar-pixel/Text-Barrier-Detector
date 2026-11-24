import { getLanguagePack } from './languages/index.js';
import type { AnalysisLanguage, LanguagePack } from './languages/types.js';
import type { AnalyzeOptions } from './analyzer.js';
import { validateInput } from './validation.js';
import { isIdentifierLike, stripMarkdown } from './markdown.js';
import { splitSentenceSpans } from './sentences.js';

export type BarrierType =
  | 'passive'
  | 'long_sentence'
  | 'complex_word'
  | 'undefined_acronym'
  | 'bureaucratic';

export interface BarrierIssue {
  /** Issue category */
  type: BarrierType;
  /** Inclusive start offset in the normalized input string */
  start: number;
  /** Exclusive end offset in the normalized input string */
  end: number;
  /** 1-based line number in the normalized input string */
  line: number;
  /** 1-based column number within the line */
  column: number;
  /** Zero-based index of the sentence containing this issue */
  sentenceIndex: number;
  /** Short, deterministic human-readable explanation */
  reason: string;
  /** Analysis language used ('en' | 'es') */
  lang: AnalysisLanguage;
  /** Exact substring (`text.slice(start, end)`) that triggered the issue */
  text: string;
}

interface WordSpan {
  raw: string;
  clean: string;
  start: number;
  end: number;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}

function extractWordSpans(sentence: string, sentenceStart: number, pack: LanguagePack): WordSpan[] {
  const results: WordSpan[] = [];
  const tokenRe = /\S+/g;
  const singleCharStrip = new RegExp(`^(?:${pack.wordCharsRe.source})+`);
  const trailingCharStrip = new RegExp(`(?:${pack.wordCharsRe.source})+$`);
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(sentence)) !== null) {
    const raw = m[0];
    const clean = raw.replace(pack.wordCharsRe, '');
    if (clean.length === 0) continue;

    const lead = singleCharStrip.exec(raw)?.[0].length ?? 0;
    const trail = trailingCharStrip.exec(raw)?.[0].length ?? 0;
    const start = sentenceStart + m.index + lead;
    const end = Math.max(start + 1, sentenceStart + m.index + raw.length - trail);
    results.push({ raw, clean, start, end });
  }
  return results;
}

const EN_PASSIVE_SPAN_RE =
  /\b(?:am|is|are|was|were|be|been|being|get|got|gets|getting)\s+(?:(?:not|never|also|always|often|still|just|already|n't|\w+ly)\s+)?(?:(?:being|been)\s+)?([a-zA-Z']+)/gi;

const ES_SER_SPAN_RE =
  /(?<![a-záéíóúüñ])(?:soy|eres|es|somos|sois|son|era|eras|éramos|erais|eran|fui|fuiste|fue|fuimos|fuisteis|fueron|seré|serás|será|seremos|seréis|serán|sería|serías|seríamos|seríais|serían|sea|seas|seamos|seáis|sean|sido|siendo)\s+[a-záéíóúüñ]+(?:ado|ados|ada|adas|ido|idos|ida|idas|to|tos|ta|tas|so|sos|sa|sas|cho|chos|cha|chas)(?![a-záéíóúüñ])/gi;

const ES_SE_SPAN_RE =
  /(?<![a-záéíóúüñ])se\s+[a-záéíóúüñ]+(?:a|e|an|en|ó|ió|aron|ieron|aba|ía|aban|ían)(?![a-záéíóúüñ])/gi;

function findPassiveSpanInSentence(
  sentence: string,
  pack: LanguagePack
): { start: number; end: number } {
  if (pack.code === 'en') {
    EN_PASSIVE_SPAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EN_PASSIVE_SPAN_RE.exec(sentence)) !== null) {
      const candidate = sentence.slice(m.index);
      if (pack.isPassive(candidate)) {
        return { start: m.index, end: m.index + m[0].length };
      }
    }
  } else {
    for (const re of [ES_SER_SPAN_RE, ES_SE_SPAN_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sentence)) !== null) {
        if (pack.isPassive(m[0])) {
          return { start: m.index, end: m.index + m[0].length };
        }
      }
    }
  }
  return { start: 0, end: sentence.length };
}

/**
 * Universal everyday and standard web/tech acronyms that rarely require
 * expansion in technical or general prose.
 */
const COMMON_ACRONYMS = new Set([
  'API', 'CLI', 'SDK', 'SQL', 'SSH', 'TLS', 'SSL', 'DNS', 'TCP', 'UDP',
  'CPU', 'GPU', 'RAM', 'SSD', 'URL', 'URI', 'PDF', 'CSV', 'PNG', 'SVG',
  'JPG', 'GIF', 'ZIP', 'HTML', 'CSS', 'JSON', 'YAML', 'XML', 'HTTP', 'HTTPS',
  'NPM', 'MCP', 'MIT', 'FAQ', 'FYI', 'CEO', 'CTO', 'CFO', 'USA', 'EUR',
  'USD', 'UTC', 'GMT', 'ISO', 'UTF', 'ASCII', 'DOM', 'IDE', 'GUI', 'ESM',
  'CJS', 'JWT', 'SHA', 'AES', 'RSA', 'IVA', 'DNI', 'NIF', 'ONU', 'RAE',
  'OMS', 'PIB', 'IPC', 'III', 'VII', 'VIII', 'XII', 'AND', 'THE', 'FOR',
  'NOT', 'ARE', 'BUT', 'ALL', 'CON', 'POR', 'LOS', 'LAS', 'DEL', 'QUE', 'UNA',
]);

function isAcronymDefined(acronym: string, fullText: string): boolean {
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Defined in parens: "Role-Based Access Control (RBAC)" or "RBAC (Role-Based Access Control)"
  const parenDef = new RegExp(`(?:\\(\\s*${escaped}\\s*\\)|\\b${escaped}\\s*\\([^)]{3,}\\))`);
  if (parenDef.test(fullText)) return true;
  // Defined inline with colon/dash or "stands for" / "means" / "significa"
  const inlineDef = new RegExp(
    `\\b${escaped}\\s*(?:[:\\-—–]\\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}|(?:stands for|means|refers to|significa|corresponde a)\\b)`,
    'i'
  );
  return inlineDef.test(fullText);
}

function isMostlyUppercase(sentence: string): boolean {
  const letters = sentence.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  return upper / letters.length > 0.6;
}

interface BureaucraticRule {
  re: RegExp;
  suggestion: string;
}

const EN_BUREAUCRATIC_RULES: BureaucraticRule[] = [
  { re: /\bin order to\b/gi, suggestion: 'to' },
  { re: /\bat this point in time\b/gi, suggestion: 'now' },
  { re: /\bdue to the fact that\b/gi, suggestion: 'because' },
  { re: /\bfor the purpose of\b/gi, suggestion: 'for / to' },
  { re: /\bin the event that\b/gi, suggestion: 'if' },
  { re: /\bwith (?:regard|respect) to\b/gi, suggestion: 'about' },
  { re: /\bprior to\b/gi, suggestion: 'before' },
  { re: /\bsubsequent to\b/gi, suggestion: 'after' },
  { re: /\bin accordance with\b/gi, suggestion: 'under / following' },
  { re: /\bmake a decision\b/gi, suggestion: 'decide' },
  { re: /\btake into consideration\b/gi, suggestion: 'consider' },
  { re: /\bhas the ability to\b/gi, suggestion: 'can' },
  { re: /\ba large number of\b/gi, suggestion: 'many' },
  { re: /\bin close proximity to\b/gi, suggestion: 'near' },
  { re: /\butili[sz]e[ds]?\b/gi, suggestion: 'use' },
  { re: /\bcommence[ds]?\b/gi, suggestion: 'start / begin' },
  { re: /\bascertain(?:ed|ing|s)?\b/gi, suggestion: 'find out' },
  { re: /\bendeavou?r(?:ed|ing|s)?\b/gi, suggestion: 'try' },
];

const ES_BUREAUCRATIC_RULES: BureaucraticRule[] = [
  { re: /(?<![a-záéíóúüñ])a (?:los )?efectos de(?![a-záéíóúüñ])/gi, suggestion: 'para' },
  { re: /(?<![a-záéíóúüñ])con el objeto de(?![a-záéíóúüñ])/gi, suggestion: 'para' },
  { re: /(?<![a-záéíóúüñ])con la finalidad de(?![a-záéíóúüñ])/gi, suggestion: 'para' },
  { re: /(?<![a-záéíóúüñ])en virtud de(?![a-záéíóúüñ])/gi, suggestion: 'según / por' },
  { re: /(?<![a-záéíóúüñ])a tenor de(?![a-záéíóúüñ])/gi, suggestion: 'según' },
  { re: /(?<![a-záéíóúüñ])en relación con(?![a-záéíóúüñ])/gi, suggestion: 'sobre' },
  { re: /(?<![a-záéíóúüñ])con respecto a(?![a-záéíóúüñ])/gi, suggestion: 'sobre' },
  { re: /(?<![a-záéíóúüñ])en el marco de(?![a-záéíóúüñ])/gi, suggestion: 'en / dentro de' },
  { re: /(?<![a-záéíóúüñ])llevar a cabo(?![a-záéíóúüñ])/gi, suggestion: 'hacer / realizar' },
  { re: /(?<![a-záéíóúüñ])dar cumplimiento a(?![a-záéíóúüñ])/gi, suggestion: 'cumplir' },
  { re: /(?<![a-záéíóúüñ])hacer entrega de(?![a-záéíóúüñ])/gi, suggestion: 'entregar' },
  { re: /(?<![a-záéíóúüñ])poner de manifiesto(?![a-záéíóúüñ])/gi, suggestion: 'mostrar / señalar' },
  { re: /(?<![a-záéíóúüñ])tomar en consideración(?![a-záéíóúüñ])/gi, suggestion: 'considerar' },
  { re: /(?<![a-záéíóúüñ])con anterioridad a(?![a-záéíóúüñ])/gi, suggestion: 'antes de' },
  { re: /(?<![a-záéíóúüñ])con posterioridad a(?![a-záéíóúüñ])/gi, suggestion: 'después de' },
  { re: /(?<![a-záéíóúüñ])en el supuesto de que(?![a-záéíóúüñ])/gi, suggestion: 'si' },
  { re: /(?<![a-záéíóúüñ])cumplimentar(?![a-záéíóúüñ])/gi, suggestion: 'completar / llenar' },
  { re: /(?<![a-záéíóúüñ])efectuar(?![a-záéíóúüñ])/gi, suggestion: 'hacer' },
];

/**
 * Deterministically finds readability barriers (`passive`, `long_sentence`,
 * `complex_word`, `undefined_acronym`, `bureaucratic`) with exact character
 * offsets, 1-based line/column coordinates, sentence index, short reason, and
 * language code. No LLM or network calls.
 */
export function findBarriers(text: string, options: AnalyzeOptions = {}): BarrierIssue[] {
  const lang: AnalysisLanguage = options.lang ?? 'en';
  validateInput(text, lang);
  const markdown = options.markdown === true;
  const ignoreSet = new Set(
    (options.ignoreWords ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean)
  );
  const normalized = text.normalize('NFC');
  const lineStarts = buildLineStarts(normalized);
  const pack = getLanguagePack(lang);
  // Same length as `normalized`, so offsets stay valid for the original text.
  const scan = markdown ? stripMarkdown(normalized) : normalized;
  const sentences = splitSentenceSpans(scan);
  const issues: BarrierIssue[] = [];
  const seenUndefinedAcronyms = new Set<string>();
  const bureaucraticRules = lang === 'es' ? ES_BUREAUCRATIC_RULES : EN_BUREAUCRATIC_RULES;

  const pushIssue = (
    type: BarrierType,
    start: number,
    end: number,
    sentenceIndex: number,
    reason: string,
    issueText: string
  ) => {
    const { line, column } = offsetToLineCol(start, lineStarts);
    issues.push({
      type,
      start,
      end,
      line,
      column,
      sentenceIndex,
      reason,
      lang,
      text: issueText,
    });
  };

  for (const s of sentences) {
    const wordSpans = extractWordSpans(s.text, s.start, pack);

    if (wordSpans.length > 20) {
      let longEnd = s.end;
      // A terminator inserted over a line break is not part of the original sentence.
      while (markdown && longEnd > s.start && /\s/.test(normalized[longEnd - 1])) longEnd--;
      pushIssue(
        'long_sentence',
        s.start,
        longEnd,
        s.index,
        lang === 'es'
          ? `Oración larga (${wordSpans.length} palabras; máximo recomendado: 20).`
          : `Long sentence (${wordSpans.length} words; recommended max is 20).`,
        markdown ? normalized.slice(s.start, longEnd) : s.text
      );
    }

    if (pack.isPassive(s.text)) {
      const rel = findPassiveSpanInSentence(s.text, pack);
      const start = s.start + rel.start;
      const end = s.start + rel.end;
      pushIssue(
        'passive',
        start,
        end,
        s.index,
        lang === 'es'
          ? 'Voz pasiva o construcción impersonal detectada; considera usar voz activa.'
          : 'Passive voice construction detected; consider rewriting in active voice.',
        normalized.slice(start, end)
      );
    }

    for (const w of wordSpans) {
      if (markdown && isIdentifierLike(w.raw)) continue;
      if (ignoreSet.has(w.clean.toLowerCase())) continue;
      if (pack.isCommonTechnical(w.clean)) continue;
      const syllables = pack.countSyllables(w.clean);
      if (syllables >= pack.complexWordMinSyllables) {
        pushIssue(
          'complex_word',
          w.start,
          w.end,
          s.index,
          lang === 'es'
            ? `Palabra compleja (${syllables} sílabas; considera un sinónimo más simple).`
            : `Complex word (${syllables} syllables; consider a simpler synonym).`,
          normalized.slice(w.start, w.end)
        );
      }
    }

    // Undefined acronyms (3–6 uppercase letters), flagged once at first occurrence.
    if (!isMostlyUppercase(s.text)) {
      const acronymRe = /\b[A-Z]{3,6}\b/g;
      let am: RegExpExecArray | null;
      while ((am = acronymRe.exec(s.text)) !== null) {
        const acr = am[0];
        if (COMMON_ACRONYMS.has(acr)) continue;
        if (ignoreSet.has(acr.toLowerCase())) continue;
        if (seenUndefinedAcronyms.has(acr)) continue;
        if (isAcronymDefined(acr, normalized)) continue;

        seenUndefinedAcronyms.add(acr);
        const start = s.start + am.index;
        const end = start + acr.length;
        pushIssue(
          'undefined_acronym',
          start,
          end,
          s.index,
          lang === 'es'
            ? `Sigla sin definir ("${acr}"); explica su significado la primera vez que aparece.`
            : `Undefined acronym ("${acr}"); spell it out on first use.`,
          normalized.slice(start, end)
        );
      }
    }

    // Bureaucratic / wordy phrases.
    for (const rule of bureaucraticRules) {
      rule.re.lastIndex = 0;
      let bm: RegExpExecArray | null;
      while ((bm = rule.re.exec(s.text)) !== null) {
        const start = s.start + bm.index;
        const end = start + bm[0].length;
        pushIssue(
          'bureaucratic',
          start,
          end,
          s.index,
          lang === 'es'
            ? `Expresión burocrática o extensa; considera usar "${rule.suggestion}".`
            : `Wordy or bureaucratic phrase; consider replacing with "${rule.suggestion}".`,
          normalized.slice(start, end)
        );
      }
    }
  }

  return issues;
}
