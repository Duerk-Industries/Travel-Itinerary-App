export const privacyPolicyHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy Policy — WanderBunnies</title>
<style>
  :root {
    color-scheme: light dark;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 760px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    color: #1c1c1e;
    background: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8ea; background: #121214; }
    a { color: #6db4ff; }
    table { border-color: #3a3a3d !important; }
    th, td { border-color: #3a3a3d !important; }
    hr { border-color: #3a3a3d !important; }
  }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin-top: 2.25rem; }
  h3 { font-size: 1.05rem; margin-top: 1.5rem; margin-bottom: 0.25rem; }
  .updated { color: #6b6b70; font-size: 0.9rem; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  th, td { border: 1px solid #d8d8db; padding: 0.5rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: rgba(127,127,127,0.08); }
  hr { border: none; border-top: 1px solid #e0e0e3; margin: 2rem 0; }
  a { color: #0066cc; }
</style>
</head>
<body>

<h1>WanderBunnies Privacy Policy</h1>
<p class="updated">Last updated: July 21, 2026</p>

<p>This policy explains what information WanderBunnies ("the app," "we," "us") collects, how we use it, and who we share it with. WanderBunnies is currently operated by Tristan Duerk.</p>

<p>If you have questions about this policy, contact us at <strong><a href="mailto:tristan.duerk@gmail.com">tristan.duerk@gmail.com</a></strong>.</p>

<hr />

<h2>1. Information We Collect</h2>

<h3>Account information</h3>
<p>When you create an account, we collect your <strong>first and last name</strong> and <strong>email address</strong>. If you sign in with Google, we receive your name and email from Google (we request only the <code>profile</code> and <code>email</code> scopes — nothing else).</p>

<h3>Profile and travel preferences</h3>
<p>You may optionally provide a <strong>home address</strong>, <strong>preferred airport</strong>, <strong>age</strong>, and <strong>gender</strong>, along with travel preferences (pace, comfort level, interests) used to personalize AI-generated itineraries. All of this is optional.</p>

<h3>Trip and travel data</h3>
<p>Information you enter about your trips: destinations, dates, flights, lodging, activities, car rentals, and expenses. Expense amounts are used only for splitting costs among travelers within the app — we do not process payments through this feature.</p>

<h3>Information about other people</h3>
<p>Because WanderBunnies is built for group travel, you may enter information about <strong>other people who are not app users</strong> — for example, a travel companion's name and email, a family member's name for relationship tracking, or a passenger's name on a flight confirmation. If you add someone this way, you are responsible for having their permission to share that information with us.</p>

<h3>Forwarded travel documents</h3>
<p>If you use our email-forwarding feature to import a booking confirmation, we receive the full content of that email (and any attachments), which may include passenger names, booking references, and other details — including about people other than you.</p>

<h3>Payment information</h3>
<p>If you subscribe to a paid plan, payment is handled entirely by <strong>Stripe</strong>, our payment processor. We never see or store your full card number. We do store your subscription status and billing history metadata (e.g., plan tier, renewal date).</p>

<h3>Communications</h3>
<p>If you email us or contact support, we keep a record of that correspondence.</p>

<h3>Diagnostic and crash data</h3>
<p>We use <strong>Sentry</strong> to automatically collect crash reports and performance diagnostics when something goes wrong in the app, to help us fix bugs.</p>

<h3>What we do <strong>not</strong> collect</h3>
<p>We do not access your device's GPS location, camera, photo library, or contacts. We do not use third-party advertising or marketing-analytics SDKs.</p>

<hr />

<h2>2. How We Use Your Information</h2>
<p>We use your information to:</p>
<ul>
  <li>Create and manage your account</li>
  <li>Let you plan trips, track expenses, and coordinate with your travel group</li>
  <li>Generate AI-assisted itineraries and parse forwarded travel confirmations</li>
  <li>Process subscription payments</li>
  <li>Send account-related emails (verification, trip invites, group invites)</li>
  <li>Diagnose and fix bugs</li>
  <li>Prevent fraud and abuse</li>
</ul>
<p>We do not sell your personal information, and we do not use it for third-party advertising.</p>

<hr />

<h2>3. How We Share Your Information</h2>
<p>We share information with the following service providers, only as needed to run the app:</p>
<table>
  <tr><th>Recipient</th><th>What they receive</th><th>Purpose</th></tr>
  <tr><td><strong>Stripe</strong></td><td>Email, payment details</td><td>Payment processing for subscriptions</td></tr>
  <tr><td><strong>OpenAI</strong></td><td>Trip details, travel preferences; passenger names and booking references when parsing forwarded confirmations</td><td>AI itinerary generation and flight-confirmation parsing</td></tr>
  <tr><td><strong>Google (Gemini)</strong></td><td>Passenger names and booking references (fallback parser)</td><td>Flight-confirmation parsing</td></tr>
  <tr><td><strong>Mailgun</strong></td><td>Full content of forwarded confirmation emails</td><td>Receiving forwarded travel documents</td></tr>
  <tr><td><strong>Sentry</strong></td><td>Crash reports, performance diagnostics</td><td>Bug diagnosis</td></tr>
  <tr><td><strong>Google</strong></td><td>Name, email (OAuth only)</td><td>"Sign in with Google"</td></tr>
  <tr><td><strong>Unsplash, Google Places</strong></td><td>Destination/place names you search — no personal information</td><td>Destination photos and place lookup</td></tr>
</table>
<p>We do not share your information with data brokers or advertisers. We may disclose information if required by law, or to protect the rights, safety, or property of WanderBunnies or our users.</p>

<hr />

<h2>4. AI Features and Your Data</h2>
<p>Some features send your data to third-party AI providers (OpenAI, Google Gemini) to work:</p>
<ul>
  <li><strong>Itinerary generation</strong> sends your trip's destinations, dates, budget, and travel-preference data (not names) to OpenAI.</li>
  <li><strong>Forwarded-confirmation parsing</strong> sends the text of your forwarded email — which can include passenger names and booking references — to OpenAI or Gemini to extract structured flight details.</li>
</ul>
<p>These providers process this data to return a response to our servers; we do not permit them to use it to train their models on our behalf beyond their standard API data-handling terms.</p>

<hr />

<h2>5. Data Retention</h2>
<p>We retain your information for as long as your account is active. If you delete your account, we delete your trip data, expenses, traits, and family/traveler relationships, and cancel any active subscriptions. Some records may be retained where required by law (e.g., financial records) or in anonymized/aggregated form.</p>

<hr />

<h2>6. Your Rights and Choices</h2>
<ul>
  <li><strong>Access and export</strong>: You can download a copy of your data at any time from your account settings (Account → Export Data).</li>
  <li><strong>Deletion</strong>: You can permanently delete your account and associated data at any time from your account settings (Account → Delete Account). This also cancels any active subscriptions.</li>
  <li><strong>Correction</strong>: You can edit most of your profile and trip information directly in the app.</li>
</ul>
<p>If you'd rather not use the app to request deletion, email us at <strong><a href="mailto:tristan.duerk@gmail.com">tristan.duerk@gmail.com</a></strong> and we'll process the request manually.</p>

<hr />

<h2>7. Children's Privacy</h2>
<p>WanderBunnies is not directed at children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, contact us and we will delete it.</p>

<hr />

<h2>8. Security</h2>
<p>We use industry-standard measures to protect your information, including encrypted connections (HTTPS) and access controls on our systems. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.</p>

<hr />

<h2>9. Changes to This Policy</h2>
<p>We may update this policy from time to time. If we make material changes, we'll notify you through the app or by email. The "Last updated" date at the top reflects the most recent revision.</p>

<hr />

<h2>10. Contact Us</h2>
<p>Questions about this policy or your data? Contact us at <strong><a href="mailto:tristan.duerk@gmail.com">tristan.duerk@gmail.com</a></strong>.</p>

</body>
</html>
`;
