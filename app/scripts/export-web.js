const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');

const HOME_URL = 'https://wander-bunnies.com/';
const PRIVACY_URL = 'https://wander-bunnies.com/privacy.html';
const TERMS_URL = 'https://wander-bunnies.com/terms.html';
const BROWSER_TITLE = 'WanderBunnies | Collaborative Trip Planner';
const APP_DESCRIPTION =
  'WanderBunnies is a professional-grade collaborative trip-planning platform for shared itineraries, lodging, transportation, activities and expenses. It integrates with Google APIs for secure authentication and travel document ingestion.';

const STATIC_PUBLIC_SECTION = `
      <div id="static-landing-preview" style="background:#f8fafc;color:#111827;padding:40px 20px;font-family:sans-serif;line-height:1.6;max-width:800px;margin:0 auto;text-align:center;">
        <header>
          <h1 style="font-size:32px;font-weight:bold;margin-bottom:8px">WanderBunnies</h1>
          <h2 style="font-size:20px;font-weight:500;color:#6B7280;margin-bottom:32px">Collaborative Itinerary & Expense Management</h2>
        </header>

        <section style="background:#fff;padding:24px;border-radius:12px;border:1px solid #E6ECEF;margin-bottom:40px">
          <p>
            WanderBunnies is a unified travel platform designed for groups. It allows users to build synchronized
            itineraries, track shared transportation and lodging, and manage a multi-currency expense ledger.
            The application integrates with <strong>Google APIs</strong> to provide
            secure authentication and optional automated travel document ingestion.
          </p>
        </section>

        <section style="text-align:left;margin-bottom:40px">
          <h3 style="font-size:18px;font-weight:600;margin-bottom:16px">Core Application Features</h3>
          <ul style="list-style:none;padding:0;display:grid;gap:12px">
            <li style="padding:12px;border:1px solid #E6ECEF;border-radius:8px">✓ Collaborative Planning: Build a shared day-by-day itinerary.</li>
            <li style="padding:12px;border:1px solid #E6ECEF;border-radius:8px">✓ Shared Expenses: Split and track shared costs in a ledger.</li>
            <li style="padding:12px;border:1px solid #E6ECEF;border-radius:8px">✓ AI Itinerary Generation: Get intelligent suggestions.</li>
            <li style="padding:12px;border:1px solid #E6ECEF;border-radius:8px">✓ Real-time Collaboration: Chat and plan together.</li>
            <li style="padding:12px;border:1px solid #E6ECEF;border-radius:8px">✓ Packing & Notes: Everything in one place.</li>
          </ul>
        </section>

        <section style="background:#f0f7ff;padding:32px;border-radius:12px;border:1px solid #bae6fd;text-align:left;margin-bottom:40px">
          <h3 style="font-size:18px;font-weight:bold;color:#0369a1;margin-bottom:16px;text-align:center">Google User Data Disclosure</h3>
          <p style="font-size:14px;color:#0c4a6e;margin-bottom:16px">
            WanderBunnies requests specific permissions from your Google Account to provide its core functionality.
            We adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style="font-weight:bold;color:#0369a1">Google API Services User Data Policy</a>, including Limited Use requirements.
          </p>
          <div style="display:grid;gap:12px">
            <div style="background:#fff;padding:12px;border-radius:8px">
              <p style="font-size:14px;margin:0"><strong>Google Identity:</strong> We use your Google profile to uniquely identify you within your groups.</p>
            </div>
            <div style="background:#fff;padding:12px;border-radius:8px">
              <p style="font-size:14px;margin:0"><strong>Gmail API (Optional):</strong> Read-only access to travel confirmation emails to populate itineraries.</p>
            </div>
          </div>
          <p style="font-size:14px;color:#0369a1;text-align:center;margin-top:24px;border-top:1px solid #bae6fd;padding-top:16px">
            Full details are available in our <a href="${PRIVACY_URL}" style="font-weight:bold;text-decoration:underline;color:#2563eb">Privacy Policy</a>.
          </p>
        </section>

        <footer style="margin-top:40px;padding-top:24px;border-top:1px solid #E6ECEF;font-size:14px;color:#6B7280">
          <nav style="margin-bottom:16px">
            <a href="${PRIVACY_URL}" style="color:#45B7C6;text-decoration:underline">Privacy Policy</a> ·
            <a href="${TERMS_URL}" style="color:#45B7C6;text-decoration:underline">Terms of Service</a> ·
            <a href="https://wander-bunnies.com/cookies.html" style="color:#45B7C6;text-decoration:underline">Cookie Policy</a>
          </nav>
          <p>© 2026 WanderBunnies · Owned and operated by Bryan Duerk</p>
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
    ].join('\n    ');
    html = html.replace(
      /(<meta\s+name=["']viewport["'][^>]*>)/i,
      `$1\n    ${metadata}`,
    );
  }

  if (!html.includes('rel="canonical"')) {
    html = html.replace('</head>', '    <link rel="canonical" href="https://wander-bunnies.com/" />\n  </head>');
  }

  const staticSection = STATIC_PUBLIC_SECTION;
  // Inject the static landing content into the root div so it's there as "ordinary static HTML".
  // This content will be shown until React hydrates and clears it.
  // This satisfies Google's "ordinary static or server-rendered HTML" requirement.
  if (html.includes('<div id="root"></div>')) {
    html = html.replace('<div id="root"></div>', `<div id="root">${staticSection}</div>`);
  } else if (html.includes('<div id="root">')) {
     // fallback if root div has attributes or content
     html = html.replace(/(<div id="root"[^>]*>)/i, `$1${staticSection}`);
  } else {
    // legacy fallback
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
