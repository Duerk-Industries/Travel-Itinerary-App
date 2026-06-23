const { spawn } = require('child_process');
const path = require('path');

const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');

const child = spawn(process.execPath, [expoCli, 'export', '--platform', 'web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_NO_SENTRY_METRO: '1',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
