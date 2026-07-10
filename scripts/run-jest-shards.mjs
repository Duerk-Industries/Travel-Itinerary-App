#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');
const runnerArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
const jestArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

const getOption = (name, fallback) => {
  const index = runnerArgs.indexOf(name);
  return index === -1 ? fallback : runnerArgs[index + 1];
};

const prefix = getOption('--prefix');
const script = getOption('--script', 'test:single');
const shardCount = Number.parseInt(getOption('--shards', '4'), 10);

if (!prefix) {
  console.error('Missing required --prefix option.');
  process.exit(1);
}

if (!Number.isInteger(shardCount) || shardCount < 1) {
  console.error(`Invalid --shards value: ${getOption('--shards')}`);
  process.exit(1);
}

const quoteForCmd = (value) => {
  const text = String(value);
  return /[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
};
const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';

for (let shard = 1; shard <= shardCount; shard += 1) {
  const shardArg = `--shard=${shard}/${shardCount}`;
  console.log(`\n[jest-shards] ${prefix}: shard ${shard}/${shardCount}`);

  const npmArgs = ['--prefix', prefix, 'run', script, '--', ...jestArgs, shardArg];
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', ['npm', ...npmArgs].map(quoteForCmd).join(' ')]
      : npmArgs;

  const result = spawnSync(npmCommand, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
