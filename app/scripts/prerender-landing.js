const fs = require('fs');
const path = require('path');

/**
 * This script post-processes the exported index.html to inject a static version
 * of the landing page. This ensures that Google's verification bots see the
 * app name, purpose, and policy links immediately without needing to execute
 * JavaScript.
 */

const distDir = path.join(__dirname, '../../dist');
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('index.html not found in dist. Run expo export first.');
  process.exit(1);
}

const landingHtml = `
<div id="static-landing-preview" style="font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; text-align: center; color: #111827;">
  <header>
    <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 8px;">WanderBunnies</h1>
    <h2 style="font-size: 20px; font-weight: 500; color: #6B7280; margin-bottom: 32px;">Collaborative Itinerary & Expense Management</h2>
  </header>

  <section style="background: #fff; padding: 24px; border-radius: 12px; border: 1px solid #E6ECEF; margin-bottom: 40px; line-height: 1.6;">
    <p>
      WanderBunnies is a collaborative trip-planning app that helps friends, families and travel groups create
      shared itineraries, organize flights and lodging, track expenses, maintain packing lists and record travel
      confirmations in one place.
    </p>
  </section>

  <section style="text-align: left; margin-bottom: 40px;">
    <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">Core Application Features</h3>
    <ul style="list-style: none; padding: 0; display: grid; gap: 12px;">
      <li style="padding: 12px; border: 1px solid #E6ECEF; border-radius: 8px;">✓ Collaborative Planning: Build a shared day-by-day itinerary.</li>
      <li style="padding: 12px; border: 1px solid #E6ECEF; border-radius: 8px;">✓ Shared Expenses: Split and track shared costs in a ledger.</li>
      <li style="padding: 12px; border: 1px solid #E6ECEF; border-radius: 8px;">✓ AI Itinerary Generation: Get intelligent suggestions.</li>
      <li style="padding: 12px; border: 1px solid #E6ECEF; border-radius: 8px;">✓ Real-time Collaboration: Chat and plan together.</li>
      <li style="padding: 12px; border: 1px solid #E6ECEF; border-radius: 8px;">✓ Packing & Notes: Everything in one place.</li>
    </ul>
  </section>

  <section style="background: #f0f7ff; padding: 32px; border-radius: 12px; border: 1px solid #bae6fd; text-align: left; margin-bottom: 40px;">
    <h3 style="font-size: 18px; font-weight: bold; color: #0369a1; margin-bottom: 16px; text-align: center;">Google User Data Disclosure</h3>
    <p style="font-size: 14px; color: #0c4a6e; margin-bottom: 16px;">
      WanderBunnies requests specific permissions from your Google Account to provide its core functionality.
      We adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style="font-weight: bold;">Google API Services User Data Policy</a>, including Limited Use requirements.
    </p>
    <div style="display: grid; gap: 12px;">
      <div style="background: #fff; padding: 12px; border-radius: 8px;">
        <p style="font-size: 14px; margin: 0;"><strong>Google Identity:</strong> We use your Google profile to identify you within your groups.</p>
      </div>
    </div>
    <p style="font-size: 14px; color: #0369a1; text-align: center; margin-top: 24px; border-top: 1px solid #bae6fd; padding-top: 16px;">
      Full details are available in our <a href="https://wander-bunnies.com/privacy.html" style="font-weight: bold; text-decoration: underline;">Privacy Policy</a>.
    </p>
  </section>

  <footer style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #E6ECEF; font-size: 14px; color: #6B7280;">
    <nav style="margin-bottom: 16px;">
      <a href="https://wander-bunnies.com/privacy.html" style="color: #45B7C6; text-decoration: underline;">Privacy Policy</a> ·
      <a href="https://wander-bunnies.com/terms.html" style="color: #45B7C6; text-decoration: underline;">Terms of Service</a> ·
      <a href="https://wander-bunnies.com/cookies.html" style="color: #45B7C6; text-decoration: underline;">Cookie Policy</a>
    </nav>
    <p>&copy; 2026 WanderBunnies · Owned and operated by Tristan Duerk, all rights reserved</p>
  </footer>
</div>
`;

const noscriptHtml = `
<noscript id="static-app-noscript">
  <main>
    <h1>WanderBunnies</h1>

    <p>
      WanderBunnies is a collaborative trip-planning application that helps
      friends, families and travel groups create shared itineraries, organize
      flights and lodging, track expenses, and maintain packing lists.
    </p>

    <h2>Google account integration</h2>

    <p>
      Google Sign-In is used to authenticate your account.
    </p>

    <p>
      <a href="https://wander-bunnies.com/privacy.html">Privacy Policy</a>
      ·
      <a href="https://wander-bunnies.com/terms.html">Terms of Service</a>
    </p>
  </main>
</noscript>
`;

let html = fs.readFileSync(indexPath, 'utf8');

// 1. Inject canonical link
if (!html.includes('rel="canonical"')) {
  html = html.replace('</head>', '  <link rel="canonical" href="https://wander-bunnies.com" />\n</head>');
}

// 2. Inject static landing content into root div
// This content will be shown until React hydraties and clears it.
// This is perfectly valid and satisfies the "ordinary static HTML" requirement.
html = html.replace('<div id="root"></div>', `<div id="root">${landingHtml}</div>${noscriptHtml}`);

fs.writeFileSync(indexPath, html);
console.log('Prerender content successfully injected into index.html');
