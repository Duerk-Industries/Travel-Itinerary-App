# Trusted receiver authentication and Gmail setup confirmations

Implemented 2026-10-20. This adds a receiver-attestation integration boundary, not an SMTP receiver or a claim that production Mailgun headers are trusted. The default remains suggestion-only until the receiver integration is deployed and validated.

## Receiver contract

The ordinary Mailgun signature check remains mandatory. In addition, a trusted receiving gateway may attach `X-WanderBunnies-Receiver-Authentication`. This is a base64url JSON payload followed by a dot and a hex HMAC-SHA256 over the encoded payload, with a separate server-side key. Use the exported `receiverContentHash` and `signReceiverAuthentication` helpers in `server/src/ingestion/shared/receiverAuthentication.ts` to produce the canonical digest and attestation.

The trusted gateway MUST discard any inbound copy of this HTTP header, validate the Mailgun transport, and derive observations only from receiver-controlled verification. It must not sign values copied from `Authentication-Results`, `ARC-Authentication-Results`, claimed From, SRS-looking text, or an unvalidated provider payload. Never put the signing secret in an app, email header, browser, log, or public API.

Version 1 payload example (illustrative identities/digests only):

```json
{
  "version": 1,
  "receiverId": "your-reviewed-receiver",
  "policyVersion": "your-validated-policy-version",
  "issuedAt": 1792530000000,
  "contentHash": "64-lowercase-hex-characters-from-receiverContentHash",
  "author": {
    "email": "bookings@airline.example",
    "dkim": "pass",
    "signingDomain": "airline.example"
  },
  "forwarder": {
    "email": "owner@example.com",
    "domain": "example.com",
    "method": "authenticated-submission"
  }
}
```

`author` records verified DKIM as pass/fail/unknown; pass requires exact signing-domain alignment with the author's domain. `forwarder` is optional. Its method is `authenticated-submission` or `validated-forwarding-chain`; either requires an actual receiver policy proving the exact forwarding mailbox. A passing airline DKIM signature, Google domain, SPF domain, ARC result, or claimed envelope mailbox does not establish that mailbox. An author-only attestation cannot grant automatic-add trust.

The canonical digest covers normalized Mailgun token/timestamp, every retained body field (including ordered message headers), attachment order, names/MIME types and SHA256 of every attachment's decoded bytes. Construct `RawMail` with `body`, `transport: { token, timestamp }`, and `files: [{ originalname, mimetype, bytes: base64 }]`. `MAIL_CONTENT_FIELDS` defines the retained string fields and their order. Sign before the application supplies missing Message-ID/Date defaults. Changes to content, alias, attachments or transport delivery invalidate the proof. Use the original Mailgun transport delivery timestamp for `issuedAt` (within one minute), not the time a retry is re-signed. Observations must be no more than nine hours old (the transport retry horizon) and no more than one minute ahead. This prevents retries from renewing an expired Gmail code.

Configure these through the usual server environment/secret mechanism:

```text
INGESTION_RECEIVER_AUTH_SECRET=<independent random secret of at least 32 characters>
INGESTION_RECEIVER_AUTH_ID=<reviewed receiver id>
INGESTION_RECEIVER_AUTH_POLICY_VERSION=<reviewed policy version>
```

Then enable the DB flag `feature_ingest_receiver_auth`. It is seeded false; a missing flag/configuration never grants trust. Turn it off or change receiver/policy to revoke queued trust; coordinate key rotation with the gateway and policy version. No production secret, flag, receiver or Mailgun route was changed by this work. Mailgun does not generate this custom attestation automatically: a receiver/gateway integration must call the signer after establishing the observations.

## Trust enforcement

A verified forwarding identity must match either the owner's verified account email or an additional address verified through the existing expiring-code flow. No universal plus-tag or Gmail-dot normalization is applied. Address removal, account changes, disabled trust flags, and receiver policy changes are rechecked when deciding whether a booking can be added automatically.

The encrypted receipt records server-authenticated provenance; the worker attaches its opaque receipt ID to the server-owned ingested document. Automatic assignment reads this document/receipt, rechecks owner/job/source/expiry, requires a passed virus scan and a currently verified forwarding mailbox, and still applies every existing confidence, duplicate, date/timezone, unique-trip and preference gate. Extracted/edited `senderTrust` fields cannot grant trust. Structured extractors that require review still require review. Uncertain ordinary mail remains a suggestion. Receiver-attested DKIM failures claiming the owner's verified email are held before scanning/extraction, with no quota reservation; Import once does not promote their trust.

## Gmail confirmations

A narrow English profile recognizes `Gmail Forwarding Confirmation` with the optional `- Receive Mail from …` suffix. It requires receiver-verified, exact `forwarding-noreply@google.com` author and `google.com` DKIM alignment; a matching requested recipient alias and a currently verified requesting account; a single nine-digit confirmation code; no attachments; and bounded text/HTML input. Text is extracted without executing HTML. Unknown/localized formats remain unverified setup mail rather than guessed confirmations.

Successful confirmations use a separate `CONFIRMATION` receipt state. The encrypted payload contains only the sanitized code/requesting account/expiry. It is retained at most 30 minutes from the receiver observation and is never scanned as a booking, sent to the LLM, charged to import quota, logged or pushed. Admission is deduplicated and still bounded by the alias's daily/queue limits. Unverified setup candidates are held and cannot be released into booking parsing; they can be deleted and requested again.

`GET /api/ingestion/forwarding/confirmations` requires the authenticated paid alias owner, returns `private, no-store`, rechecks verified addresses/current alias/receiver policy/expiry and returns only id, provider, code, requestedBy and expiresAt. Rotation hides old-alias codes immediately. No message URL, raw body, HTML, subject or attachment is returned. The Imports → Gmail setup panel fetches only this endpoint, fences account/alias changes, drops expired codes and lets the person copy the code and complete Gmail settings themselves. It never follows confirmation links or creates mail rules. No Gmail OAuth scope was added.

## Validation and remaining deployment evidence

Contract tests cover signed/unsigned and tampered bodies, attachments, transport and alias replay; stale/future observations; unknown policies; domain-only trust rejection; current address verification; server-owned provenance and passed-scan requirements; encrypted/idempotent/quota-free confirmations; cross-owner access; alias rotation/expiry; and unverified setup quarantine. Existing Mailgun, sender-verification, admission and automatic-assignment tests remain in the focused check. Frontend checks cover copying, expiry, malicious/unsolicited URLs and account changes. The owner-only confirmation integration also runs against the Firestore emulator.

`tests/fixtures/gmail-forwarding-confirmation.en.redacted.json` is explicitly a synthetic redacted contract fixture, not a captured Gmail/Mailgun message. Before enabling production, validate the deployed gateway's header provenance and exact mailbox alignment with real Gmail/Outlook/Apple forwarding fixtures, plus real Gmail confirmation delivery (including the supported template's formatting). This repository does not assert SPF/DKIM/ARC trust from unsigned headers. These external checks remain release gates, not evidence supplied by Jest.

Primary references: [Mailgun HTTP receive fields and signatures](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http), [Mailgun authentication-result delivery announcement](https://www.mailgun.com/releases/authentication-results-in-inbound-route-url-posts/), [RFC 7601 trust boundary](https://www.rfc-editor.org/rfc/rfc7601.html), [Google forwarding setup](https://support.google.com/mail/answer/10957?hl=en).

Latest local validation: eight focused backend suites passed 58 tests, followed by final provenance/retry checks adding three cases (61 distinct passing tests across the focused runs). Four frontend suites passed 11 tests; the Firestore emulator confirmation suite passed five tests. Frontend TypeScript, backend build, production web export and diff checks passed. Full workspace suites and live Gmail/receiver delivery were not run.
