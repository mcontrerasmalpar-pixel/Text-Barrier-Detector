import { classifyLevel } from './levelClassifier.js';
import type { LevelResult } from './levelClassifier.js';
import { computeStructureScore } from './structure.js';
import { computeInflesz, getLanguagePack } from './languages/index.js';
import type { AnalysisLanguage, FormulaName, LanguagePack } from './languages/index.js';
import { validateInput } from './validation.js';
import { isIdentifierLike, removeMarkdownNoise, stripMarkdown } from './markdown.js';
import { splitSentenceSpans } from './sentences.js';
export { AnalysisError, MAX_INPUT_CHARS } from './validation.js';
export type { AnalysisErrorCode, AnalysisErrorDetails } from './validation.js';
export type { AnalysisLanguage, FormulaName, LanguagePack } from './languages/index.js';

export interface AnalyzeOptions {
  /** Analysis language ('en' | 'es'). Defaults to 'en'. */
  lang?: AnalysisLanguage;
  /**
   * Treat the input as Markdown: code, tables, badges, URLs and link targets are
   * ignored so only prose is scored (default `false`). Offsets reported by
   * `findBarriers` still refer to the original string.
   */
  markdown?: boolean;
  /**
   * Case-insensitive list of domain/product words or acronyms to ignore when
   * flagging complex words and undefined acronyms (team glossary).
   */
  ignoreWords?: string[];
}

export interface SentenceAnalysis {
  text: string;
  wordCount: number;
  isLong: boolean;
  hasPassiveVoice: boolean;
  complexWords: string[];
  index: number;
}

export interface AnalysisResult {
  sentences: SentenceAnalysis[];
  fleschScore: number;
  fleschLabel: string;
  gradeLevel: number;
  avgSentenceLength: number;
  passiveCount: number;
  complexWordCount: number;
  structureScore: number;
  overallScore: number;
  totalWords: number;
  totalSentences: number;
  totalSyllables: number;
  suggestions: string[];
  /** Readability Band (A1–C2): CEFR-inspired, not a certification */
  level: LevelResult;
  /** Analysis language used for heuristics */
  language: AnalysisLanguage;
  /** Readability formula applied to fleschScore */
  formulaName: FormulaName;
  /** INFLESZ / Szigriszt-Pazos perspicuity score (0–100), populated when `language === 'es'`. */
  infleszScore?: number;
  /** Barrio-Cantalejo INFLESZ scale label, populated when `language === 'es'`. */
  infleszLabel?: string;
}

function getWords(text: string, pack: LanguagePack): string[] {
  return text.split(/\s+/).filter(w => w.replace(pack.wordCharsRe, '').length > 0);
}

function cleanWord(word: string, pack: LanguagePack): string {
  return word.replace(pack.wordCharsRe, '');
}

function buildIgnoreSet(ignoreWords?: string[]): Set<string> {
  if (!ignoreWords || ignoreWords.length === 0) return new Set();
  return new Set(ignoreWords.map((w) => w.trim().toLowerCase()).filter(Boolean));
}

function findComplexWords(
  words: string[],
  pack: LanguagePack,
  markdown = false,
  ignoreSet: Set<string> = new Set()
): string[] {
  return words
    .filter(w => !(markdown && isIdentifierLike(w)))
    .map(w => cleanWord(w, pack))
    .filter(w => {
      if (w.length === 0) return false;
      if (ignoreSet.has(w.toLowerCase())) return false;
      if (pack.isCommonTechnical(w)) return false;
      return pack.countSyllables(w) >= pack.complexWordMinSyllables;
    });
}

function getEaseLabel(score: number): string {
  if (score >= 90) return 'Very easy';
  if (score >= 70) return 'Easy';
  if (score >= 50) return 'Moderate';
  if (score >= 30) return 'Difficult';
  return 'Very difficult';
}

/**
 * Analyze text readability. Throws `AnalysisError` (localized message) when the
 * input is not a string, is empty/whitespace-only, exceeds MAX_INPUT_CHARS, or
 * when `lang` is not supported.
 */
export function analyzeText(
  text: string,
  lang: AnalysisLanguage = 'en',
  options: Pick<AnalyzeOptions, 'markdown' | 'ignoreWords'> = {}
): AnalysisResult {
  validateInput(text, lang);
  const pack = getLanguagePack(lang);
  const markdown = options.markdown === true;
  const ignoreSet = buildIgnoreSet(options.ignoreWords);
  // Compose combining marks so "o" + U+0301 and "ó" are analyzed identically.
  text = text.normalize('NFC');
  // In Markdown mode, prose metrics use a prose-only view; structure keeps headings and lists.
  const prose = markdown ? stripMarkdown(text) : text;
  const structureSource = markdown ? removeMarkdownNoise(text) : text;
  const sentences = splitSentenceSpans(prose).map(s => (markdown ? s.text.replace(/\s+/g, ' ') : s.text));
  const allWords = getWords(prose, pack);
  const totalWords = allWords.length;
  const totalSentences = Math.max(sentences.length, 1);
  const totalSyllables = allWords.reduce(
    (sum, w) => sum + pack.countSyllables(cleanWord(w, pack)),
    0
  );
  const avgSentenceLength = totalWords / totalSentences;

  const rawEase =
    totalWords === 0 ? 0 : pack.readingEase(totalWords, totalSentences, totalSyllables);

  const fleschScore = Math.max(0, Math.min(100, rawEase));

  const gradeLevel =
    totalWords === 0
      ? 0
      : Math.max(
          0,
          0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59
        );

  let passiveCount = 0;
  let complexWordCount = 0;

  const sentenceAnalyses: SentenceAnalysis[] = sentences.map((s, i) => {
    const words = getWords(s, pack);
    const isLong = words.length > 20;
    const hasPassive = pack.isPassive(s);
    const complex = findComplexWords(words, pack, markdown, ignoreSet);
    if (hasPassive) passiveCount++;
    complexWordCount += complex.length;
    return { text: s, wordCount: words.length, isLong, hasPassiveVoice: hasPassive, complexWords: complex, index: i };
  });

  const structureWords = markdown ? getWords(structureSource, pack).length : totalWords;
  const structureScore = computeStructureScore(structureSource, structureWords);

  const sentenceLengthScore = Math.max(0, 100 - (sentenceAnalyses.filter(s => s.isLong).length / totalSentences) * 100);
  const passiveScore = Math.max(0, 100 - (passiveCount / totalSentences) * 100);
  const complexScore = Math.max(0, 100 - (complexWordCount / Math.max(totalWords, 1)) * 200);
  const overallScore = Math.round(
    fleschScore * 0.35 + sentenceLengthScore * 0.2 + passiveScore * 0.15 +
    Math.max(0, complexScore) * 0.15 + structureScore * 0.15
  );

  const suggestions: string[] = [];
  if (avgSentenceLength > 20) suggestions.push('Break long sentences into shorter ones (aim for under 20 words).');
  if (passiveCount > 0) suggestions.push('Convert passive voice to active voice for clarity.');
  if (complexWordCount > 3) suggestions.push('Replace complex words with simpler alternatives.');
  if (structureScore < 50) suggestions.push('Add paragraph breaks, headings, or lists to improve structure.');
  if (fleschScore < 50) suggestions.push('Simplify vocabulary and shorten sentences to improve readability.');

  const inflesz =
    lang === 'es' ? computeInflesz(totalWords, totalSentences, totalSyllables) : undefined;

  const partial = {
    sentences: sentenceAnalyses,
    fleschScore: Math.round(fleschScore * 10) / 10,
    fleschLabel: getEaseLabel(fleschScore),
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    passiveCount,
    complexWordCount,
    structureScore,
    overallScore: Math.min(100, Math.max(0, overallScore)),
    totalWords,
    totalSentences,
    totalSyllables,
    suggestions: suggestions.slice(0, 3),
    language: lang,
    formulaName: pack.formulaName,
    ...(inflesz ? { infleszScore: inflesz.score, infleszLabel: inflesz.label } : {}),
  };

  return {
    ...partial,
    level: classifyLevel(partial as AnalysisResult),
  };
}

/**
 * Analyze text readability with an options object
 * (`{ lang?: 'en' | 'es', markdown?: boolean, ignoreWords?: string[] }`).
 */
export function analyze(text: string, options: AnalyzeOptions = {}): AnalysisResult {
  const lang = options.lang ?? 'en';
  return analyzeText(text, lang, {
    markdown: options.markdown,
    ignoreWords: options.ignoreWords,
  });
}
