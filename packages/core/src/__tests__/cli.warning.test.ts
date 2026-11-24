import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const cliPath = resolve(__dirname, '../../../../scripts/analyze.mjs');

function runCli(args: string[], input?: string): { stdout: string; stderr: string } {
  // Spawn node with piped stderr so we can inspect warnings cleanly.
  const script = `
    const { spawnSync } = require('node:child_process');
    const res = spawnSync(process.execPath, ${JSON.stringify([cliPath, ...args])}, {
      input: ${JSON.stringify(input ?? '')},
      encoding: 'utf8',
    });
    process.stdout.write(JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr }));
  `;
  const raw = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const parsed = JSON.parse(raw) as { status: number; stdout: string; stderr: string };
  expect(parsed.status).toBe(0);
  return { stdout: parsed.stdout, stderr: parsed.stderr };
}

describe('CLI scripts/analyze.mjs markdown backtick warning', () => {
  it('warns on stderr when input has backticks without --markdown, while keeping stdout valid JSON', () => {
    const mdText = 'Run `npm install` to set up the tool.';
    const { stdout, stderr } = runCli(['-'], mdText);

    expect(stderr).toMatch(/Warning:.*Markdown.*backticks.*--markdown/i);
    const json = JSON.parse(stdout);
    expect(json.totalWords).toBeGreaterThan(0);
  });

  it('does not warn when --markdown is passed', () => {
    const mdText = 'Run `npm install` to set up the tool.';
    const { stdout, stderr } = runCli(['--markdown', '-'], mdText);

    expect(stderr.trim()).toBe('');
    const json = JSON.parse(stdout);
    expect(json.totalWords).toBeGreaterThan(0);
  });

  it('does not warn on plain text without backticks', () => {
    const { stderr } = runCli(['-'], 'Run the installer to set up the tool.');
    expect(stderr.trim()).toBe('');
  });
});
