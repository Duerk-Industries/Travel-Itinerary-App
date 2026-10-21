import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPacket, evaluatePacket } from './lib/gapEvidence';

// No env files are loaded and no deployment, provider call or flag mutation occurs.
function main() {
  const [mode, file, environment, ...extra] = process.argv.slice(2);
  if (!['init', 'check'].includes(mode) || !file || !environment || extra.length) {
    throw new Error('Usage: npm run evidence:gap -- <init|check> <packet.json> <environment>');
  }
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (mode === 'init') {
    writeFileSync(file, `${JSON.stringify(createPacket(gitSha, environment), null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Created pending evidence packet: ${file}\n`);
    return;
  }
  const report = evaluatePacket(JSON.parse(readFileSync(file, 'utf8')), {
    gitSha, environment, root: path.dirname(path.resolve(file)),
  });
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    report.failures.push('Working tree is dirty; commit release source before collecting final evidence');
    report.passed = false;
  }
  process.stdout.write(`${JSON.stringify({ gitSha, environment, ...report }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
try { main(); }
catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
