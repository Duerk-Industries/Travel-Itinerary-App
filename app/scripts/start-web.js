const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '..', 'server', '.env') });

const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
const portArgs = useInMemory ? ['--port', '80'] : [];
const cmd = process.platform === 'win32' ? 'npx expo start --web --offline' : 'npx expo start --web --offline';
const fullCmd = portArgs.length ? `${cmd} ${portArgs.join(' ')}` : cmd;

const child = spawn(fullCmd, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
