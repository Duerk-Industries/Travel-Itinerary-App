const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const loadEnv = (envPath, override = false) => {
  dotenv.config({ path: envPath, override });
};

loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.join(__dirname, '..', '..', '.env'), true);
loadEnv(path.join(__dirname, '..', '..', 'server', '.env'), true);
loadEnv(path.join(__dirname, '..', '..', 'server', '.local_env'), true);

if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
  const fallback =
    process.env.BACKEND_URL ||
    process.env.WEB_URL ||
    process.env.API_BASE_URL;
  if (fallback) {
    process.env.EXPO_PUBLIC_BACKEND_URL = fallback;
  }
}

const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
const portFlagIndex = process.argv.indexOf('--port');
const requestedPort = portFlagIndex !== -1 ? process.argv[portFlagIndex + 1] : undefined;
const portArgs = requestedPort ? ['--port', requestedPort] : useInMemory ? ['--port', '80'] : [];
const cmd = process.platform === 'win32' ? 'npx expo start --web --offline' : 'npx expo start --web --offline';
const fullCmd = portArgs.length ? `${cmd} ${portArgs.join(' ')}` : cmd;

const child = spawn(fullCmd, {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_NO_SENTRY_METRO: '1',
    // Expo generates workspace-root-relative entry and lazy-module URLs for
    // monorepos. Tell app/metro.config.js to serve those URLs from the same
    // root while leaving native Gradle bundling rooted at app/.
    WANDERBUNNIES_WEB_DEV: '1',
  },
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
