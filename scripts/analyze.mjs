#!/usr/bin/env node
/**
 * CLI for the Text Barrier Detector analyzer (EN + ES).
 *
 * This is a thin wrapper: all analysis lives in `@makitaki/text-barrier-core`,
 * built to `packages/core/dist/` by `npm run build:core`.
 *
 * Usage: node scripts/analyze.mjs [--lang=en|es] [--markdown] [--ignore=word1,word2] <path-to-text-file | ->
 *        ("-" reads the text from stdin)
 * Output: JSON analysis result on stdout (includes the Readability Band,
 *         A1-C2, which is CEFR-inspired and not a certification).
 * Warnings: Human-readable hints (e.g. Markdown detected without --markdown) on stderr.
 * Errors: JSON { "error": { code, message, details } } on stderr.
 *         Exit code 2 = invalid input, 1 = usage / unexpected error.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { analyzeText, AnalysisError } from '../packages/core/dist/index.js';

function fail(code, message, exitCode = 1, details = {}) {
  console.error(JSON.stringify({ error: { code, message, details } }));
  process.exit(exitCode);
}

function parseArgs(argv) {
  let lang = 'en';
  let filePath = null;
  let markdown = false;
  let ignoreWords = [];
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--lang=')) {
      lang = arg.slice('--lang='.length).toLowerCase();
    } else if (arg === '--markdown') {
      markdown = true;
    } else if (arg.startsWith('--ignore=')) {
      ignoreWords = arg
        .slice('--ignore='.length)
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
    } else if (arg === '--lang') {
      fail('USAGE', 'Usage: --lang=en or --lang=es');
    } else if (arg === '-' || !arg.startsWith('-')) {
      filePath = arg;
    } else {
      fail('USAGE', `Unknown option: ${arg}`);
    }
  }
  return { lang, filePath, markdown, ignoreWords };
}

const { lang, filePath, markdown, ignoreWords } = parseArgs(process.argv);
if (!filePath) {
  fail(
    'USAGE',
    'Usage: node scripts/analyze.mjs [--lang=en|es] [--markdown] [--ignore=word1,word2] <path-to-text-file | ->'
  );
}

let text;
try {
  text = readFileSync(filePath === '-' ? 0 : filePath, 'utf8');
} catch (err) {
  fail('READ_ERROR', `Cannot read ${filePath}: ${err.message}`);
}

if (!markdown) {
  const hasBackticks = text.includes('`');
  const isMdExt = filePath !== '-' && /\.(?:md|mdx)$/i.test(extname(filePath));
  if (hasBackticks || isMdExt) {
    const reason = hasBackticks && isMdExt
      ? 'backticks and .md extension detected'
      : hasBackticks
        ? 'backticks detected'
        : '.md file detected';
    console.error(
      `Warning: Input looks like Markdown (${reason}) without --markdown. Re-run with --markdown to ignore code blocks, tables, badges, and URLs.`
    );
  }
}

try {
  console.log(JSON.stringify(analyzeText(text, lang, { markdown, ignoreWords }), null, 2));
} catch (err) {
  if (err instanceof AnalysisError) {
    fail(err.code, err.message, 2, err.details);
  }
  fail('UNEXPECTED', err instanceof Error ? err.message : String(err));
}
