# Implementation Plan: GCP Cost Optimization (Secret Manager & Networking)

This plan outlines steps to reduce GCP operational spend by optimizing Secret Manager API usage and networking egress patterns.

## 1. Secret Manager Optimization

### Context
Cloud Run is currently configured to mount secrets as environment variables (via `--set-secrets` in deployment scripts). However, `server/src/secrets.ts` still uses the `@google-cloud/secret-manager` SDK to fetch secrets on demand.

### Actions
- [ ] **Refactor `getSecret`**: Update `server/src/secrets.ts` to prioritize `process.env`.
- [ ] **Singleton Client**: If SDK usage is retained as a fallback, ensure the `SecretManagerServiceClient` is a singleton rather than being instantiated on every call.
- [ ] **In-Memory Caching**: Implement a simple in-memory cache with a long TTL (e.g., 1 hour) for any secrets fetched via the SDK.

### Implementation Detail (`server/src/secrets.ts`)
```typescript
let smClient: SecretManagerServiceClient | null = null;
const secretCache = new Map<string, { value: string; expires: number }>();

export async function getSecret(secretName: string): Promise<string | undefined> {
  // 1. Check process.env (mounted secrets)
  if (process.env[secretName]) return process.env[secretName];

  // 2. Check local file (dev mode)
  if (isLocalEnv()) return getSecretFromLocalFile(secretName);

  // 3. Check memory cache
  const cached = secretCache.get(secretName);
  if (cached && cached.expires > Date.now()) return cached.value;

  // 4. Fallback to SDK (with singleton client)
  smClient ??= new SecretManagerServiceClient();
  // ... fetch and update cache ...
}
```

## 2. Networking & Egress Optimization

### Context
The application uses GCS to store and serve media assets via Signed URLs. Direct egress from GCS to the internet is more expensive than egress through a CDN.

### Actions
- [ ] **Verify Region Affinity**: Ensure the `LOCATION_BUCKET` and the upcoming `BLOG_QUARANTINE_BUCKET`/`BLOG_SERVING_BUCKET` are located in `us-east5` (matching Cloud Run and Firestore).
- [ ] **Public Media CDN**: For public blog assets, move away from Signed URLs. Instead:
    - Use a load balancer with **Cloud CDN** enabled.
    - Or leverage **Firebase Hosting rewrites** to proxy GCS content, benefiting from the Firebase CDN.
- [ ] **Aggressive Rendition Sizing**: In `blogMediaProcessingService.ts`, ensure "web-optimized" images do not exceed 2048px and thumbnails are kept under 50KB.
- [ ] **Client-Side Lazy Loading**: Ensure the frontend `TripBlogTab` uses `react-native-fast-image` or standard `Image` with `loading="lazy"` (on web) to prevent over-fetching.

## 3. Database Connectivity

### Context
The app connects to Firestore. If moving to Cloud SQL (Postgres) in the future:
- [ ] **VPC Connector**: Use a Serverless VPC Access connector to keep database traffic on the internal Google network, avoiding public egress charges and improving latency.

## 4. Verification & Monitoring

- [ ] **Billing Dashboard**: Create a custom dashboard in GCP Billing to track "Secret Manager: Access Secret Version" and "Compute Engine: Network Egress" specifically.
- [ ] **Trace SDK Calls**: Use Cloud Trace to ensure `SecretManagerServiceClient` is not appearing in request traces for common API endpoints.

## 5. Timeline
- **Phase 1 (Immediate)**: Secret Manager refactor (Zero cost, high impact).
- **Phase 2 (Next Deploy)**: Verify regions and add CDN for public blog assets.
- **Phase 3 (Ongoing)**: Monitor egress patterns as the Trip Blog feature scales.
