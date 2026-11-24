import { describe, it, expect } from 'vitest';
import {
  analyze,
  computeInflesz,
  findBarriers,
  splitSentenceSpans,
} from '../index.js';
import type { AnalysisLanguage, BarrierType } from '../index.js';

describe('v0.2.0 Spanish readability formulas (Fernández-Huerta + INFLESZ)', () => {
  const simpleEs =
    'El sol sale hoy. Los niños van al parque. Ellos juegan con la pelota roja. Todos ríen mucho.';
  const standardEs =
    'Esta guía explica cómo configurar tu cuenta paso a paso. Primero abre los ajustes y elige tu idioma. Luego guarda los cambios para aplicar la nueva configuración.';
  const denseLegalEs =
    'En virtud de las disposiciones reglamentarias precedentemente establecidas y con la finalidad de garantizar el cumplimiento ininterrumpido de las obligaciones administrativas correspondientes, los solicitantes deberán cumplimentar exhaustivamente la documentación justificativa pertinente con anterioridad a la finalización del procedimiento extraordinario.';

  it('produces realistic, non-saturated Fernández-Huerta scores that rank simple > standard > dense', () => {
    const simple = analyze(simpleEs, { lang: 'es' });
    const standard = analyze(standardEs, { lang: 'es' });
    const dense = analyze(denseLegalEs, { lang: 'es' });

    expect(simple.fleschScore).toBeGreaterThan(75);
    expect(standard.fleschScore).toBeGreaterThan(45);
    expect(standard.fleschScore).toBeLessThan(85);
    expect(dense.fleschScore).toBeLessThan(40);

    expect(simple.fleschScore).toBeGreaterThan(standard.fleschScore);
    expect(standard.fleschScore).toBeGreaterThan(dense.fleschScore);
  });

  it('populates INFLESZ (Szigriszt-Pazos) score and label for Spanish only', () => {
    const esRes = analyze(standardEs, { lang: 'es' });
    const enRes = analyze('This guide explains how to set up your account.', { lang: 'en' });

    expect(esRes.infleszScore).toBeDefined();
    expect(esRes.infleszLabel).toBeDefined();
    expect(esRes.infleszScore!).toBeGreaterThan(40);
    expect(esRes.infleszScore!).toBeLessThan(90);

    expect(enRes.infleszScore).toBeUndefined();
    expect(enRes.infleszLabel).toBeUndefined();

    // Direct helper sanity check: 15 words/sentence, 2.0 syllables/word -> 67.2 (Bastante fácil)
    const direct = computeInflesz(15, 1, 30);
    expect(direct.score).toBe(67.2);
    expect(direct.label).toBe('Bastante fácil');
  });
});

describe('v0.2.0 smart sentence splitting', () => {
  it('does not split on English abbreviations, versions, or initials', () => {
    const text =
      'Use common tools, e.g. Node.js or Python, to run v0.1.1 locally. Dr. J. K. Smith tested it with approx. 50 files, etc. Then she shipped it.';
    const spans = splitSentenceSpans(text);
    expect(spans).toHaveLength(3);
    expect(spans[0].text).toContain('e.g. Node.js');
    expect(spans[0].text).toContain('v0.1.1');
    expect(spans[1].text).toContain('Dr. J. K. Smith');
    expect(spans[2].text).toBe('Then she shipped it.');
  });

  it('does not split on Spanish abbreviations (p. ej., Sra., art., núm.)', () => {
    const text =
      'Usa formatos abiertos, p. ej. Markdown o texto plano, según el art. 4 del manual. La Sra. Pérez revisó el núm. 12 ayer.';
    const spans = splitSentenceSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0].text).toContain('p. ej. Markdown');
    expect(spans[0].text).toContain('art. 4');
    expect(spans[1].text).toContain('Sra. Pérez');
  });
});

describe('v0.2.0 ignoreWords glossary & line/column coordinates', () => {
  it('suppresses complex_word and undefined_acronym entries listed in ignoreWords', () => {
    const text = 'Configure RBAC with counterintuitive juxtaposition rules.';
    const baseline = findBarriers(text, { lang: 'en' });
    expect(baseline.some((i) => i.type === 'undefined_acronym' && i.text === 'RBAC')).toBe(true);
    expect(baseline.some((i) => i.type === 'complex_word' && i.text === 'juxtaposition')).toBe(true);

    const filtered = findBarriers(text, {
      lang: 'en',
      ignoreWords: ['rbac', 'Juxtaposition'],
    });
    expect(filtered.some((i) => i.text === 'RBAC')).toBe(false);
    expect(filtered.some((i) => i.text === 'juxtaposition')).toBe(false);
    expect(filtered.some((i) => i.text === 'counterintuitive')).toBe(true);

    const analysis = analyze(text, {
      lang: 'en',
      ignoreWords: ['juxtaposition', 'counterintuitive'],
    });
    expect(analysis.complexWordCount).toBe(0);
  });

  it('reports accurate 1-based line and column numbers across multiline text', () => {
    const text = 'Short line.\nThe report was written.\n  Use RBAC now.';
    const issues = findBarriers(text, { lang: 'en' });

    const passive = issues.find((i) => i.type === 'passive');
    expect(passive).toBeDefined();
    expect(passive!.line).toBe(2);
    expect(passive!.column).toBe(12); // "The report " = 11 chars -> "was" starts at col 12

    const acr = issues.find((i) => i.type === 'undefined_acronym');
    expect(acr).toBeDefined();
    expect(acr!.line).toBe(3);
    expect(acr!.column).toBe(7); // "  Use " = 6 chars -> "RBAC" starts at col 7
  });
});

describe('v0.2.0 undefined_acronym and bureaucratic barriers', () => {
  it('flags undefined acronyms once and skips defined or universal ones', () => {
    const text =
      'Enable RBAC for your API. Use RBAC carefully. We follow Service Level Agreement (SLA) targets.';
    const issues = findBarriers(text, { lang: 'en' });
    const acronyms = issues.filter((i) => i.type === 'undefined_acronym');

    expect(acronyms).toHaveLength(1);
    expect(acronyms[0].text).toBe('RBAC');
    expect(acronyms[0].sentenceIndex).toBe(0);
  });

  it('detects bureaucratic/wordy phrases in EN and ES', () => {
    const enIssues = findBarriers(
      'In order to save time, we utilize short guides prior to launch.',
      { lang: 'en' }
    ).filter((i) => i.type === 'bureaucratic');
    expect(enIssues.map((i) => i.text.toLowerCase())).toEqual([
      'in order to',
      'prior to',
      'utilize',
    ]);

    const esIssues = findBarriers(
      'Con el objeto de mejorar el proceso, vamos a llevar a cabo una revisión con anterioridad a la entrega.',
      { lang: 'es' }
    ).filter((i) => i.type === 'bureaucratic');
    expect(esIssues.map((i) => i.text.toLowerCase())).toEqual([
      'con el objeto de',
      'llevar a cabo',
      'con anterioridad a',
    ]);
  });
});

describe('v0.2.0 Precision / Recall / F1 evaluation corpus', () => {
  interface EvalCase {
    lang: AnalysisLanguage;
    text: string;
    expectedTypes: BarrierType[];
  }

  const corpus: EvalCase[] = [
    // English positives & negatives
    { lang: 'en', text: 'The report was written by the team.', expectedTypes: ['passive'] },
    { lang: 'en', text: 'The team wrote the report.', expectedTypes: [] },
    { lang: 'en', text: 'She is excited about the launch.', expectedTypes: [] },
    { lang: 'en', text: 'Configure RBAC before deployment.', expectedTypes: ['undefined_acronym'] },
    {
      lang: 'en',
      text: 'Configure Role-Based Access Control (RBAC) before launch.',
      expectedTypes: [],
    },
    { lang: 'en', text: 'Call the API over HTTP with JSON.', expectedTypes: [] },
    { lang: 'en', text: 'In order to start, click save.', expectedTypes: ['bureaucratic'] },
    { lang: 'en', text: 'To start, click save.', expectedTypes: [] },
    // Spanish positives & negatives
    { lang: 'es', text: 'El informe fue revisado por el equipo.', expectedTypes: ['passive'] },
    { lang: 'es', text: 'El equipo revisó el informe.', expectedTypes: [] },
    { lang: 'es', text: 'Se me olvidó la clave.', expectedTypes: [] },
    { lang: 'es', text: 'Activa MTTR en el panel.', expectedTypes: ['undefined_acronym'] },
    {
      lang: 'es',
      text: 'Activa el tiempo medio de recuperación (MTTR) en el panel.',
      expectedTypes: [],
    },
    {
      lang: 'es',
      text: 'En virtud de la norma, vamos a llevar a cabo el cambio.',
      expectedTypes: ['bureaucratic'],
    },
    { lang: 'es', text: 'Según la norma, haremos el cambio.', expectedTypes: [] },
  ];

  it('achieves >= 0.90 Precision, Recall, and F1 on passive, undefined_acronym, and bureaucratic', () => {
    const tracked: BarrierType[] = ['passive', 'undefined_acronym', 'bureaucratic'];
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const sample of corpus) {
      const found = new Set(
        findBarriers(sample.text, { lang: sample.lang })
          .map((i) => i.type)
          .filter((t) => tracked.includes(t))
      );
      const expected = new Set(sample.expectedTypes);

      for (const t of found) {
        if (expected.has(t)) tp++;
        else fp++;
      }
      for (const t of expected) {
        if (!found.has(t)) fn++;
      }
    }

    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    const f1 = (2 * precision * recall) / (precision + recall);

    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(f1).toBeGreaterThanOrEqual(0.9);
  });
});
