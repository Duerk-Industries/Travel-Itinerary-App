/// <reference types="jest" />
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app';
import { privacyPolicyHtml } from '../src/legal/privacyPolicyHtml';

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');

describe('legal pages (analytics Phase 4)', () => {
  it('generated privacy pages match docs/legal/privacy-policy.md (drift guard)', () => {
    // Fails with instructions when someone edits privacy.html or privacyPolicyHtml.ts by hand,
    // or edits the Markdown without regenerating.
    expect(() => execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-legal-pages.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('/privacy and /privacy.html serve the same canonical notice', () => {
    expect(read('app/public/privacy.html')).toBe(privacyPolicyHtml.replace(/\r\n/g, '\n'));
  });

  it('serves /privacy from the canonical notice with the required disclosures', async () => {
    const res = await request(app).get('/privacy').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const text = res.text;
    expect(text).toContain('Tristan Duerk');
    expect(text).toContain('support@wander-bunnies.com');
    expect(text).not.toMatch(/bryan\.duerk@gmail\.com|tristan\.duerk@gmail\.com/);
    expect(text).toMatch(/age 16 or older/);
    expect(text).not.toMatch(/under 13/);
    expect(text).toMatch(/Optional product analytics/);
    expect(text).toMatch(/off unless you/);
    expect(text).toMatch(/Global Privacy Control/);
    expect(text).toMatch(/Push notification tokens/);
    expect(text).toMatch(/90 days/);
    expect(text).toMatch(/Limited Use/); // Google API disclosure must survive regeneration
    expect(text).toMatch(/Financial account connections/); // Plaid section
    expect(text).toMatch(/none appointed at this time/); // no claim of an EU/UK representative
  });

  it.each([
    ['/privacy-choices', '/privacy-choices.html'],
    ['/delete-account', '/delete-account.html'],
    ['/cookies', '/cookies.html'],
    ['/terms', '/terms.html'],
  ])('redirects %s to %s instead of the SPA shell', async (alias, target) => {
    const res = await request(app).get(alias).expect(301);
    expect(res.headers.location).toBe(target);
  });

  it('public choice and deletion pages name the operator, link the notice, and load no scripts', () => {
    for (const page of ['app/public/privacy-choices.html', 'app/public/delete-account.html']) {
      const html = read(page);
      expect(html).toContain('Tristan Duerk');
      expect(html).toContain('/privacy.html');
      expect(html).not.toMatch(/<script/i); // generates no optional analytics
    }
    const deletion = read('app/public/delete-account.html');
    expect(deletion).toMatch(/What is kept, and why/);
    expect(deletion).toMatch(/without reinstalling/);
  });
});
