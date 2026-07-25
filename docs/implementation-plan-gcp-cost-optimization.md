# Implementation Plan: GCP Cost Optimization (Secret Manager & Networking)

This plan outlines steps to reduce GCP operational spend by optimizing Secret Manager API usage and networking egress patterns.

## 1. Secret Manager Optimization

### Context
Cloud Run is currently configured to mount secrets as environment variables (via `--set-secrets` in deployment scripts). However, `server/src/secrets.ts` still uses the `@google-cloud/secret-manager` SDK to fetch secrets on demand.

### Actions
- [x] **Refactor `getSecret`**: Update `server/src/secrets.ts` to prioritize `process.env`.
- [x] **Singleton Client**: Ensure the `SecretManagerServiceClient` is a singleton rather than being instantiated on every call.
- [x] **In-Memory Caching**: Implement a simple in-memory cache with a long TTL (e.g., 1 hour) for any secrets fetched via the SDK.

## 2. Networking & Egress Optimization

### Context
The application uses GCS to store and serve media assets via Signed URLs. Direct egress from GCS to the internet is more expensive than egress through a CDN.

### Actions
- [x] **Verify Region Affinity**: Ensure the `LOCATION_BUCKET` and the `BLOG_QUARANTINE_BUCKET`/`BLOG_SERVING_BUCKET` are located in `us-east5` (matching Cloud Run and Firestore).
- [ ] **Public Media CDN**: For public blog assets, move away from Signed URLs. Instead:
    - Use a load balancer with **Cloud CDN** enabled.
    - Or leverage **Firebase Hosting rewrites** to proxy GCS content, benefiting from the Firebase CDN.
- [ ] **Aggressive Rendition Sizing**: In `blogMediaProcessingService.ts`, ensure "web-optimized" images do not exceed 2048px and thumbnails are kept under 50KB.
- [ ] **Client-Side Lazy Loading**: Ensure the frontend `TripBlogTab` uses lazy loading to prevent over-fetching.

## 3. Database Connectivity

### Context
The app connects to Firestore. If moving to Cloud SQL (Postgres) in the future:
- [ ] **VPC Connector**: Use a Serverless VPC Access connector to keep database traffic on the internal Google network.

## 4. Verification & Monitoring

- [ ] **Billing Dashboard**: Create a custom dashboard in GCP Billing to track "Secret Manager: Access Secret Version" and "Compute Engine: Network Egress" specifically.
