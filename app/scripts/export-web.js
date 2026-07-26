const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');

const HOME_URL = 'https://wander-bunnies.com/';
const PRIVACY_URL = 'https://wander-bunnies.com/privacy.html';
const TERMS_URL = 'https://wander-bunnies.com/terms.html';
const BROWSER_TITLE = 'WanderBunnies | Collaborative Trip Planner';
const APP_DESCRIPTION =
  'WanderBunnies is a collaborative trip-planning app for shared itineraries, lodging, transportation, activities and expenses.';

const STATIC_PUBLIC_SECTION = `
      <div id="static-app-description" style="position:fixed;inset:0;z-index:100000;overflow:auto;background:#102438;color:#fff;padding:32px 20px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6">
        <header style="max-width:800px;margin:0 auto 24px">
          <a href="${HOME_URL}" aria-label="WanderBunnies home" style="color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:12px">
            <img src="/favicon.ico" width="48" height="48" alt="WanderBunnies" />
            <span style="font-size:24px;font-weight:700">WanderBunnies</span>
          </a>
        </header>
        <main style="max-width:800px;margin:0 auto">
          <h1 style="font-size:36px;line-height:1.2;margin:0 0 12px">WanderBunnies</h1>
          <p>${APP_DESCRIPTION} It helps friends, families and travel groups create shared itineraries, organize flights and lodging, track expenses, maintain packing lists and optionally import travel confirmations from Gmail.</p>
          <h2>What WanderBunnies does</h2>
          <ul>
            <li>Create and edit shared day-by-day itineraries.</li>
            <li>Organize transportation, lodging and activities.</li>
            <li>Track and split expenses among travelers.</li>
            <li>Collaborate through shared notes, lists and trip chat.</li>
            <li>Optionally import travel confirmations from Gmail.</li>
          </ul>
          <h2>Why we ask for your information</h2>
          <p>Google Sign-In requests your name and email address so we can identify you to your travel group and secure your account. Optional Gmail import requests read-only Gmail access only when you enable it, so WanderBunnies can identify travel messages and attachments, extract itinerary details, and show the results for your review.</p>
          <p>We do not sell Google user data or use it for advertising. Read our <a href="${PRIVACY_URL}">Privacy Policy</a>.</p>
        </main>
        <footer style="max-width:800px;margin:32px auto 0;border-top:1px solid #476176;padding-top:16px">
          <a href="${PRIVACY_URL}" style="color:#8dd8ff;margin-right:16px">Privacy Policy</a>
          <a href="${TERMS_URL}" style="color:#8dd8ff">Terms of Service</a>
          <p style="font-size:13px;color:#b6c7d5">© 2026 WanderBunnies · Owned and operated by Bryan Duerk</p>
        </footer>
      </div>`;

const getOutputDirectory = (args) => {
  const outputDirFlag = args.find((arg) => arg.startsWith('--output-dir='));
  if (outputDirFlag) return path.resolve(process.cwd(), outputDirFlag.slice('--output-dir='.length));

  const outputDirIndex = args.indexOf('--output-dir');
  if (outputDirIndex >= 0 && args[outputDirIndex + 1]) {
    return path.resolve(process.cwd(), args[outputDirIndex + 1]);
  }

  return path.resolve(process.cwd(), 'dist');
};

const addPublicMetadata = (args) => {
  const indexPath = path.join(getOutputDirectory(args), 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Expo export completed but ${indexPath} was not found.`);
  }

  let html = fs.readFileSync(indexPath, 'utf8');

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${BROWSER_TITLE}</title>`);

  if (!/<meta\s+name=["']description["']/i.test(html)) {
    const metadata = [
      `<meta name="description" content="${APP_DESCRIPTION}" />`,
      '<meta name="application-name" content="WanderBunnies" />',
      `<meta property="og:title" content="${BROWSER_TITLE}" />`,
      '<meta property="og:url" content="https://wander-bunnies.com/" />',
      '<meta property="og:description" content="Plan shared itineraries, transportation, lodging, activities and expenses with WanderBunnies." />',
      '<meta property="og:type" content="website" />',
      '<link rel="canonical" href="https://wander-bunnies.com/" />',
    ].join('\n    ');
    html = html.replace(
      /(<meta\s+name=["']viewport["'][^>]*>)/i,
      `$1\n    ${metadata}`,
    );
  }

  const staticSection = STATIC_PUBLIC_SECTION;
  if (/<noscript>[\s\S]*?<\/noscript>/i.test(html)) {
    html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, staticSection);
  } else if (/<div\s+id=["']static-app-description["'][\s\S]*?<\/div>/i.test(html)) {
    html = html.replace(/<div\s+id=["']static-app-description["'][\s\S]*?<\/div>/i, staticSection);
  } else {
    html = html.replace(/(<body[^>]*>)/i, `$1\n    ${staticSection}`);
  }

  fs.writeFileSync(indexPath, html);
  console.log(`Added public app metadata and no-JavaScript description to ${indexPath}`);
};

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
  if (code === 0) {
    try {
      addPublicMetadata(process.argv.slice(2));
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }
  process.exit(code ?? 0);
});
