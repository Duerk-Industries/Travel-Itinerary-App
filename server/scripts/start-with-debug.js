const fs = require('fs');
const { spawn } = require('child_process');

const logDebugFile = (path) => {
  try {
    if (!fs.existsSync(path)) {
      return;
    }
    const content = fs.readFileSync(path, 'utf8');
    if (content.trim().length > 0) {
      console.error(`--- ${path} ---`);
      console.error(content);
      console.error(`--- end ${path} ---`);
    }
  } catch (err) {
    console.error(`Failed to read ${path}:`, err);
  }
};

const child = spawn(process.execPath, ['server/dist/index.js'], { stdio: 'inherit' });

child.on('exit', (code) => {
  if (code && code !== 0) {
    logDebugFile('/workspace/npm-debug.log');
    logDebugFile('/workspace/server/npm-debug.log');
  }
  process.exit(code ?? 1);
});
