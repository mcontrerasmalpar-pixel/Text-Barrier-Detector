# Changelog

All notable changes to this project and its published packages (`@makitaki/text-barrier-core` and `@makitaki/text-barrier-mcp`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-24

### Fixed

- **Spanish Fernández-Huerta formula (`es.ts`):** Corrected `P` to syllables per 100 words (`100 * syllables / words`) instead of syllables per word, eliminating score saturation at `100` on standard and dense Spanish prose.

### Added

- **INFLESZ / Szigriszt-Pazos (`es`):** `analyze` / `analyzeText` now populate `infleszScore` (0–100) and `infleszLabel` (Barrio-Cantalejo scale) for Spanish texts, and `computeInflesz` is exported from `@makitaki/text-barrier-core`.
- **Smart sentence splitting (`splitSentenceSpans`):** Avoids false sentence boundaries on EN/ES abbreviations (`e.g.`, `i.e.`, `p. ej.`, `etc.`, `Dr.`, `Sr.`, `Sra.`, `art.`, `núm.`), single-letter initials (`J. K.`), version numbers (`v0.1.1`), and ellipses before lowercase words.
- **Team glossary (`ignoreWords`):** Optional `ignoreWords?: string[]` in `AnalyzeOptions`, MCP tools (`analyze_text`, `find_barriers`, `check_file`), and CLI (`--ignore=word1,word2`) to suppress domain terms and acronyms.
- **Line & column coordinates on barriers:** Every `BarrierIssue` now includes 1-based `line` and `column` fields alongside `start`/`end` offsets for editor and PR-diff annotations.
- **New deterministic barrier types:**
  - `undefined_acronym`: flags undefined 3–6 letter uppercase acronyms on first occurrence (ignoring universal tech acronyms, defined acronyms, and `ignoreWords`).
  - `bureaucratic`: detects wordy/bureaucratic phrases in English and Spanish with simpler replacement suggestions.
- **CLI Markdown warning (`scripts/analyze.mjs`):** Prints a hint to `stderr` (keeping `stdout` valid JSON) when backticks or a `.md`/`.mdx` file are passed without `--markdown`.
- **Precision / Recall / F1 evaluation corpus:** Added labeled EN/ES evaluation tests verifying ≥ 0.90 Precision, Recall, and F1.

## [0.1.1] - 2026-11-20

### Added

- **Markdown-aware analysis** (`markdown: true`) in `@makitaki/text-barrier-core` (`analyze`, `findBarriers`) and in the MCP tools `analyze_text` and `find_barriers`. Code blocks, inline code, tables, badges, images, URLs, link targets, front matter and HTML are ignored so only prose is scored. Headings and list layout still count for the structure score, and `start`/`end` offsets still index the original text.
- `stripMarkdown`, `removeMarkdownNoise` and `isIdentifierLike` helpers exported from the core package.
- `--markdown` flag for `scripts/analyze.mjs`; the readability GitHub Action now analyzes PR and issue bodies as Markdown.

### Changed

- `check_file` analyzes `.md` files as Markdown automatically and returns `markdown: true | false` in its result. `.txt` files are unchanged.
- In Markdown mode, identifier-like tokens (package names, paths, `snake_case`) are never reported as complex words.
- On this repository's `README.md` the Markdown mode changes the score from Band C1, overall 45/100, Flesch 0 and 201 complex words to Band B1, overall 64/100, Flesch 30.7 and 28 complex words. Structure score is unchanged (85).

### Notes

- `markdown` defaults to `false` in the core and in `analyze_text` / `find_barriers`, so existing integrations behave exactly as in 0.1.0.

## [0.1.0] - 2026-11-20

### Added

- **`@makitaki/text-barrier-core` (`packages/core`):**
  - Pure TypeScript readability and barrier detector (`analyze`, `analyzeText`, `findBarriers`) with zero runtime dependencies, no DOM, and no network calls.
  - `LanguagePack` architecture shipping English (`en`, Flesch Reading Ease) and Spanish (`es`, Fernández-Huerta `206.84 - 1.02*P - 0.60*S`) packs.
  - Deterministic `findBarriers(text, { lang })` returning `passive`, `long_sentence`, and `complex_word` issues with exact `start`/`end` character offsets, `sentenceIndex`, localized `reason`, and `lang`.
  - Refined English passive detector with irregular participle list and phrasal-verb (*"is turned on"*), raising-verb (*"is said to be"*), and adjectival participle (*"is interested in"*) exclusions.
  - Refined Spanish passive detector (*ser* + participle and *se*-passive/impersonal) with reflexive/accidental clitic exclusions (*"Se me olvidó"*).
  - Density-aware structure scoring that evaluates paragraphs, lists, and headings relative to word count so empty formatting cannot reach `100/100`.
  - **Readability Band (A1–C2)** classifier with explicit disclaimer (`"CEFR-inspired readability heuristic, not a CEFR assessment or certification."`).
  - Input validation (`AnalysisError`) for non-string (`INVALID_TYPE`), empty (`EMPTY_TEXT`), `> 1,000,000` characters (`TEXT_TOO_LONG`), and unsupported language (`UNSUPPORTED_LANGUAGE`) with localized messages (`en`/`es`).
- **`@makitaki/text-barrier-mcp` (`packages/mcp`):**
  - Official `@modelcontextprotocol/sdk` (`stdio`) server exposing `analyze_text`, `find_barriers`, and `check_file` (`.md` / `.txt`).
  - Official MCP Registry manifest (`server.json`, schema `2025-12-11`) and `mcpName` metadata (`io.github.mcontrerasmalpar-pixel/text-barrier-mcp`).
- **CI & Quality:**
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`) running `npm ci`, `npm run build:mcp`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
  - Regression test suites for EN/ES passive voice, Unicode `NFC`/`NFD`, punctuation-only input, `100,000`-word stress tests, and MCP `stdio` client-server integration tests.

### Removed

- Removed dead browser-side Claude rewrite card (`SuggestionCard.tsx` and `claudeEnhancer.ts`); plain-language rewrites are handled by the host LLM consuming `@makitaki/text-barrier-mcp`.
- Removed duplicate `bun.lock` and `bun.lockb` lockfiles in favor of a single npm workspace lockfile (`package-lock.json`).
