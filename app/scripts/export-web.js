const { spawn } = require('child_process');
const path = require('path');

const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');

const child = spawn(process.execPath, [expoCli, 'export', '--platform', 'web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_NO_SENTRY_METRO: '1',
    // Expo emits workspace-root-relative entry and lazy-module paths in this
    // monorepo. Keep Metro's server root aligned during static web exports,
    // just as the local web launcher does.
    WANDERBUNNIES_WEB_DEV: '1',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
