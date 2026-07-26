const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');

const BROWSER_TITLE = 'WanderBunnies – Collaborative Trip Planner';
const APP_DESCRIPTION =
  'WanderBunnies is a collaborative trip planner for organizing shared itineraries, transportation, lodging, activities, and expenses.';

const STATIC_PUBLIC_SECTION = `
      <main id="static-app-description">
        <h1>WanderBunnies</h1>
        <p>${APP_DESCRIPTION}</p>
        <h2>What you can do</h2>
        <ul>
          <li>Build a shared day-by-day itinerary with flights, lodging, activities, and car rentals.</li>
          <li>Split and track shared expenses in a running cost ledger.</li>
          <li>Generate AI-assisted itinerary suggestions from destinations and dates.</li>
          <li>Chat with your group and keep shared packing lists and trip notes.</li>
        </ul>
        <h2>Why we ask for your information</h2>
        <p>Google Sign-In requests your name and email address so we can identify you to your travel group and secure your account. Optional Gmail import requests read-only Gmail access only when you enable it, so WanderBunnies can identify travel messages and attachments, extract itinerary details, and show the results for your review.</p>
        <p>We do not sell Google user data or use it for advertising. Read our <a href="privacy.html">Privacy Policy</a>.</p>
      </main>`;

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
      `<meta property="og:description" content="${APP_DESCRIPTION}" />`,
      '<meta property="og:type" content="website" />',
    ].join('\n    ');
    html = html.replace(
      /(<meta\s+name=["']viewport["'][^>]*>)/i,
      `$1\n    ${metadata}`,
    );
  }

  const staticSection = `<noscript>${STATIC_PUBLIC_SECTION}\n    </noscript>`;
  if (/<noscript>[\s\S]*?<\/noscript>/i.test(html)) {
    html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, staticSection);
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
