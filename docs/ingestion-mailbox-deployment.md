# Mailbox Ingestion Deployment

## Default address

The launch mailbox address is `travel.docs@duerk.org`.

User-facing settings may display the current forwarding address and forwarding instructions, but changing the underlying destination is an admin-managed infrastructure change. It may require DNS, provider, and deployment updates.

## Provider comparison

Scores below are launch-oriented and optimize for inbound webhook support, attachment handling, maintainability, and predictable cost. Pricing and feature details are based on current vendor documentation and some implementation-risk scoring is an engineering inference.

| Option | Cost | Reliability | Ease | Attachment support | Spam handling | Webhook support | Security | Maintainability | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| AWS SES inbound | 10 | 9 | 6 | 9 | 7 | 7 | 9 | 8 | Lowest variable cost, strong AWS primitives, more setup |
| Mailgun inbound routes | 6 | 8 | 9 | 9 | 7 | 10 | 8 | 9 | Best launch ergonomics, easy webhook parsing |
| SendGrid inbound parse | 5 | 8 | 8 | 8 | 6 | 9 | 7 | 8 | Good webhook product, pricing less favorable for inbound-only use |
| Google Workspace mailbox | 4 | 8 | 7 | 8 | 8 | 3 | 8 | 5 | Simple mailbox, but no purpose-built inbound webhook pipeline |

## Recommendation

### Primary launch provider

Use **Mailgun inbound routes** for Phase 2 launch.

Why:

- It already supports routing incoming mail to an HTTP endpoint.
- It sends `multipart/form-data` when attachments exist, which matches the normalization intake requirements.
- It includes HMAC signature fields (`signature`, `timestamp`, `token`) and documented retry behavior.
- It is operationally simpler than building SES receipt rules plus S3/Lambda plumbing for the first production release.

### Fallback provider

Use **AWS SES inbound** as the fallback and likely longer-term scale option.

Why:

- It is the lowest-cost option at both 100-user and 10,000-user scale.
- It supports storing raw MIME to S3, optional encryption, and Lambda/SNS fan-out.
- It better matches a future worker-oriented architecture once webhook volume, observability, and replay tooling mature.

## Scale rationale

### At 100 users

Mailgun is the better launch tradeoff. The absolute volume is small, so operator time matters more than the marginal cost difference. Faster setup, easier webhook parsing, and simpler inbound testing are more valuable than squeezing infrastructure cost.

### At 10,000 users

SES becomes more attractive. At larger volume, per-message economics and AWS-native storage/event pipelines outweigh the extra configuration burden. The system should still keep the provider adapter boundary clean so this swap is operational rather than architectural.

## Launch deployment instructions

### Mailgun launch path

1. Verify the receiving domain and DNS in Mailgun.
2. Create the forwarding address alias for `travel.docs@duerk.org`.
3. Create a route that matches the launch alias.
4. Forward matching messages to the ingestion webhook endpoint.
5. Validate HMAC signature, timestamp freshness, and replay token handling server-side.
6. Persist only the minimum travel-relevant content needed for normalization and extraction.

### AWS SES fallback path

1. Verify the receiving domain in SES.
2. Create a receipt rule set for the launch alias.
3. Deliver raw MIME to S3.
4. Trigger Lambda asynchronously from SES or S3 event flow.
5. Hand off to the app ingestion adapter using the shared `IngestionPayload`.

## Google Workspace mailbox option

Google Workspace can work as a dedicated mailbox or catch-all receiver, and Google documents multiple routing modes like catch-all, split delivery, and dual delivery. It is not the recommended launch choice because it does not give us the same purpose-built inbound webhook model as Mailgun or the event-storage pipeline shape of SES.

## Source links

- Google Workspace pricing: https://workspace.google.com/pricing
- Google Workspace routing: https://support.google.com/a/answer/2685650?hl=en
- Google Workspace catch-all routing: https://support.google.com/a/answer/12943537?hl=en
- AWS SES pricing: https://aws.amazon.com/ses/pricing/
- AWS SES receiving to S3: https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html
- Mailgun receiving overview: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-forward-store
- Mailgun route HTTP payloads: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- Mailgun pricing: https://www.mailgun.com/pricing/
- SendGrid inbound parse: https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/inbound-email
- SendGrid pricing: https://www.twilio.com/en-us/products/email-api/pricing
