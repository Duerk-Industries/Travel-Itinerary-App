#!/usr/bin/env node
/**
 * Compiles the canonical privacy notice (docs/legal/privacy-policy.md) into the two
 * places it is served from, so they can never disagree again:
 *   - app/public/privacy.html            → /privacy.html (web export, linked from the app)
 *   - server/src/legal/privacyPolicyHtml.ts → /privacy (served by the API server)
 *
 *   node scripts/build-legal-pages.mjs          write both outputs
 *   node scripts/build-legal-pages.mjs --check  exit 1 if either output is stale (CI drift guard)
 *
 * Edit only the Markdown. See docs/implementation-plans/analytics-upgrade.md (Phase 4).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'docs/legal/privacy-policy.md');
const HTML_OUT = path.join(root, 'app/public/privacy.html');
const TS_OUT = path.join(root, 'server/src/legal/privacyPolicyHtml.ts');

const normalize = (text) => text.replace(/\r\n/g, '\n');

const parseFrontMatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${SOURCE} must start with a --- front-matter block (title, version, effective, changes)`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  for (const key of ['title', 'version', 'effective']) {
    if (!meta[key]) throw new Error(`front matter is missing "${key}"`);
  }
  return { meta, body: text.slice(match[0].length) };
};

const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLES = `
  :root { color-scheme: light dark; --text: #263238; --heading: #111827; --muted: #5b6875; --border: #dbe3ec; --head-bg: #eef4fb; --bg: #ffffff; --link: #1d4ed8; --note-bg: #fff7ed; --note-border: #f97316; }
  @media (prefers-color-scheme: dark) { :root { --text: #e2e8f0; --heading: #f8fafc; --muted: #94a3b8; --border: #334155; --head-bg: #1e293b; --bg: #0f172a; --link: #93c5fd; --note-bg: #3b2410; --note-border: #fb923c; } }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.65; color: var(--text); background: var(--bg); max-width: 900px; margin: 0 auto; padding: 32px 16px; }
  h1 { color: var(--heading); border-bottom: 2px solid var(--border); padding-bottom: 10px; }
  h2 { color: var(--heading); margin-top: 34px; }
  h3 { color: var(--heading); margin-top: 24px; }
  p, li { max-width: 80ch; }
  table { width: 100%; border-collapse: collapse; margin: 18px 0 24px; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--border); padding: 10px; text-align: left; vertical-align: top; }
  th { background: var(--head-bg); }
  blockquote { background: var(--note-bg); border-left: 5px solid var(--note-border); margin: 18px 0; padding: 10px 16px; }
  a { color: var(--link); }
  .footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--border); color: var(--muted); font-size: .92em; }`;

export const renderPrivacyPage = (markdown) => {
  const { meta, body } = parseFrontMatter(normalize(markdown));
  const content = marked.parse(body, { gfm: true, async: false }).trim();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="WanderBunnies ${escapeHtml(meta.title)}, version ${escapeHtml(meta.version)}">
<title>${escapeHtml(meta.title)} - WanderBunnies</title>
<!-- GENERATED from docs/legal/privacy-policy.md by scripts/build-legal-pages.mjs. Do not edit. -->
<style>${STYLES}
</style>
</head>
<body>
${content}
<div class="footer">&copy; 2026 WanderBunnies · Owned and operated by Tristan Duerk · Version ${escapeHtml(meta.version)}, effective ${escapeHtml(meta.effective)}</div>
</body>
</html>
`;
};

export const renderPrivacyModule = (html) => `// GENERATED from docs/legal/privacy-policy.md by scripts/build-legal-pages.mjs. Do not edit.
// Served at /privacy; identical to app/public/privacy.html.
export const privacyPolicyHtml = ${JSON.stringify(html)};
`;

const main = () => {
  const html = renderPrivacyPage(readFileSync(SOURCE, 'utf8'));
  const outputs = [
    [HTML_OUT, html],
    [TS_OUT, renderPrivacyModule(html)],
  ];
  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([file, expected]) => {
      try {
        return normalize(readFileSync(file, 'utf8')) !== expected;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`Legal pages are out of date: ${stale.map(([file]) => path.relative(root, file)).join(', ')}`);
      console.error('Edit docs/legal/privacy-policy.md, then run: node scripts/build-legal-pages.mjs');
      process.exit(1);
    }
    console.log('Legal pages are up to date.');
    return;
  }
  for (const [file, content] of outputs) writeFileSync(file, content);
  console.log(`Wrote ${outputs.map(([file]) => path.relative(root, file)).join(', ')}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
