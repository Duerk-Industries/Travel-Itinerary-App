# Travel Itinerary App — Google Cloud + Firestore Runbook (duerk.org)

Opinionated, repo-specific steps for running this app locally with the Firestore emulator and in Google Cloud (Firestore + Cloud Run + Firebase Hosting), plus CI builds for web and Expo (iOS/Android) on `main`. Region: **us-east5**. Cloud Run service name: **travel-itinerary-app**. Auth: **Application Default Credentials (ADC)** on Cloud Run preferred.

## 1) Architecture (this repo)
- **API**: Node/Express in `server/`, deployed to **Cloud Run**.
- **Database**: **Firestore** (hosted). Local dev uses the Firestore emulator.
- **Web**: React/Expo web served by **Firebase Hosting**; `/api/**` is proxied to Cloud Run.
- **Native**: Expo (EAS) builds for iOS and Android; app config lives in `app.json`.
- **Custom domain**: `duerk.org` (Firebase Hosting manages SSL; DNS points to Hosting).

## 2) Prereqs (once)
- Google Cloud project with billing (e.g., [GCLOUD_PROJECT_ID]) and Firebase enabled.
- Tools: `gcloud`, `firebase-tools`, Node LTS, Docker, `expo-cli`/`eas` (for local builds).
- Access to Expo account `duerk-industries` and Apple/Play credentials for store uploads.

## 3) Environment config
- **Server `.env` (hosted Firestore, ADC on Cloud Run)**  
  ```env
  PORT=4000
  DB_PROVIDER=firebase
  USE_IN_MEMORY_DB=0
  GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID]  # your project ID
  GCLOUD_PROJECT=[GCLOUD_PROJECT_NUMBER]  # optional, for some SDK features
  # ADC preferred on Cloud Run; only set keys if you must override ADC (not recommended):
  # FIREBASE_CLIENT_EMAIL=...
  # FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----
  ```

- **Server `.env` (local emulator)**  
  ```env
  DB_PROVIDER=firebase
  USE_IN_MEMORY_DB=0
  GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID]  # your project ID
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
  GCLOUD_PROJECT=[GCLOUD_PROJECT_NUMBER]  # optional, for some SDK features
  ```

- **Expo backend URL**: point to `https://duerk.org` for production. Use `EXPO_PUBLIC_BACKEND_URL` or a dev build to target local API/emulator during development.

## 4) Local development with Firestore emulator
1) `npm install` (root), then install inside `server/` and `app/` if needed.  
2) Start emulators: `firebase emulators:start` (Firestore 8080, Auth 9099).  
3) Run API: `cd server && npm run dev` (uses emulator via env above).  
4) Run Expo: `cd app && npm start` (use a dev build or env override to hit local API).  

## 5) Cloud setup (Firestore + Cloud Run + Hosting)
1) Set project: `gcloud auth login && gcloud config set project [GCLOUD_PROJECT_ID]`.  
2) Enable APIs:  
   ```
   gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
   ```  
3) Create Firestore (Production mode) in **us-east5** (or your preferred region).  
4) IAM for Cloud Run service account (default `[GCLOUD_PROJECT_NUMBER]-compute@developer.gserviceaccount.com` or your custom one):  
   ```
   gcloud projects add-iam-policy-binding [GCLOUD_PROJECT_ID] \
     --member="serviceAccount:[GCLOUD_PROJECT_NUMBER]-compute@developer.gserviceaccount.com" \
     --role="roles/datastore.user"
   gcloud projects add-iam-policy-binding [GCLOUD_PROJECT_ID] \
     --member="serviceAccount:[GCLOUD_PROJECT_NUMBER]-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```
   (Secret Manager access is granted proactively in case you choose to mount secrets.)
5) Secrets (optional if using ADC):  
   - Prefer ADC on Cloud Run (no private key).  
   - If you must use keys, store `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in Secret Manager and grant accessor.  
6) Deploy API to Cloud Run (source deploy, **us-east5**):  
   ```bash
   cd server
   gcloud run deploy travel-itinerary-app \
     --source . \
     --region us-east5 \
     --allow-unauthenticated \
     --set-env-vars=DB_PROVIDER=firebase,USE_IN_MEMORY_DB=0,GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID]
   ```
   If you use secrets for keys, add `--set-secrets=FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest`.
7) Firebase Hosting rewrite to Cloud Run (`firebase.json`):  
   ```json
   {
     "hosting": {
       "public": "public",
       "rewrites": [
         { "source": "/api/**", "run": { "serviceId": "travel-itinerary-app", "region": "us-east5" } },
         { "source": "**", "destination": "/index.html" }
       ]
     }
   }
   ```
   Deploy Hosting: `firebase deploy --only hosting`.
8) Domain `duerk.org`: Firebase Console → Hosting → Add custom domain → follow TXT + A/AAAA (or CNAME) instructions at your registrar. SSL auto-provisioned. Result: `https://duerk.org` with `/api/**` proxied to Cloud Run.

## 6a) HTTPS certificate for duerk.org
- Firebase Hosting provisions and renews the TLS certificate automatically after domain verification.
- Steps (recap):
  1. Firebase Console → Hosting → Add custom domain → enter `duerk.org`.
  2. Add the TXT record for verification at your domain registrar.
  3. Add A/AAAA (or CNAME for `www`) records per the wizard.
  4. Wait for DNS to propagate; Hosting will issue and attach the cert. No manual certificate handling required.
  5. Test: `https://duerk.org` and `https://duerk.org/api/health` (or similar) should load over HTTPS without warnings.

## 6b) SMTP/email setup on Google Cloud (send/receive)
Recommended: use a managed email provider; simplest with Google Workspace + SMTP relay.

Option A — Google Workspace SMTP relay (send mail):
1. Obtain a Google Workspace domain account (e.g., admin@duerk.org).
2. In Google Admin Console → Apps → Google Workspace → Gmail → Routing → SMTP relay service:
   - Allow addresses from `duerk.org`.
   - Restrict to IPs you trust or require authentication.
3. In app config (`server/.env`):
   ```
   SMTP_HOST=smtp-relay.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-workspace-user@duerk.org   # if using auth; relay may allow unauth from trusted IPs
   SMTP_PASS=app_password_or_oauth_token    # app password if 2FA; or use OAuth2 if preferred
   SMTP_FROM="Shared Trip Planner <noreply@duerk.org>"
   ```
4. Ensure Cloud Run egress can reach `smtp-relay.gmail.com:587`. For strict auth, use an App Password (if 2FA) or OAuth2.

Option B — Mailgun (transactional email):
1. Create a Mailgun account and add a sending domain (e.g., `mg.duerk.org` or `duerk.org`).
2. Add the required DNS records at your registrar for that domain: SPF (TXT), DKIM (CNAME/TXT), and tracking/CNAME if desired (Mailgun console provides exact records).
3. Verify the domain in Mailgun, then create a Private API key.
4. Store the API key in Secret Manager; optionally also store the SMTP credentials Mailgun provides.
5. App config examples:
   - Using SMTP:
     ```
     SMTP_HOST=smtp.mailgun.org
     SMTP_PORT=587
     SMTP_USER=postmaster@mg.duerk.org        # adjust to your Mailgun SMTP user
     SMTP_PASS=MAILGUN_SMTP_PASSWORD          # store in Secret Manager
     SMTP_FROM="Shared Travel Itinerary <noreply@duerk.org>"
     ```
   - Using API (preferred for resilience): keep the API key in Secret Manager and call Mailgun’s API from the server; still set `SMTP_FROM` for consistency.

Receiving email (inbound):
- Google Cloud does not host inbound SMTP directly. To receive mail at `@duerk.org`, use Google Workspace (recommended) or your email provider’s inbox routing.
- If you need to process inbound mail, use the provider’s webhooks (e.g., SendGrid inbound parse, Mailgun routes) and point them to a Cloud Run endpoint.

## 6) CI/CD on `main`
- **API (Cloud Run)** via GitHub Actions (example):  
  ```yaml
  jobs:
    deploy-api:
      if: github.ref == 'refs/heads/main'
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: google-github-actions/auth@v2
          with:
            credentials_json: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }} # SA with run.admin + iam.serviceAccountUser (+ secret accessor if needed)
        - uses: google-github-actions/setup-gcloud@v2
        - run: gcloud config set project [GCLOUD_PROJECT_ID]
        - run: |
            cd server
            gcloud run deploy travel-itinerary-app \
              --source . \
              --region us-east5 \
              --allow-unauthenticated \
              --set-env-vars=DB_PROVIDER=firebase,USE_IN_MEMORY_DB=0,GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID]
  ```
  Add `--set-secrets=...` if using key secrets.

- **Hosting**: already configured via `.github/workflows/firebase-hosting-merge.yml` (live on `main`). Ensure `firebase.json` has the `/api/**` rewrite.  

- **Expo EAS (iOS + Android + web)** — recommended: Expo-managed credentials + `EXPO_TOKEN` in GitHub secrets:  
  ```yaml
  jobs:
    expo-eas-build:
      if: github.ref == 'refs/heads/main'
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: expo/expo-github-action@v8
          with:
            eas-version: latest
            token: ${{ secrets.EXPO_TOKEN }}
        - run: |
            cd app
            eas build --platform ios --profile production --non-interactive
            eas build --platform android --profile production --non-interactive
            # Replace Hosting content with Expo web export on main
            npx expo export:web --output-dir ../public
  ```
  - iOS: configure Apple credentials in Expo (App Store Connect API key) or via secrets.  
  - Android: use Expo-managed keystore or supply via secrets.  
  - The Expo web export replaces `public/`, which Hosting serves with the `/api/**` rewrite intact.

## 7) Smoke tests post-deploy
- API: `curl https://duerk.org/api/web-auth/login` (expect 400/401, not 5xx).  
- Firestore: create/list trips in app; confirm data in Firestore console.  
- Web: `https://duerk.org` loads.  
- Native: latest EAS build hits `https://duerk.org/api/...`.  

## 8) Checklist
- [ ] Cloud Run service `travel-itinerary-app` deployed in `us-east5` (ADC).  
- [ ] Cloud Run SA has `roles/datastore.user` and `roles/secretmanager.secretAccessor`.  
- [ ] `firebase.json` rewrite `/api/**` → Cloud Run; Hosting deployed.  
- [ ] Domain `duerk.org` mapped in Firebase Hosting; DNS updated.  
- [ ] Expo backend URL set to `https://duerk.org`.  
- [ ] GitHub secrets: `GCP_SERVICE_ACCOUNT_KEY`, `EXPO_TOKEN`, (optional) `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` if you decide to use keys.  
- [ ] Firestore rules/indexes deployed (`firestore.rules`, `firestore.indexes.json`).  

## 9) Decisions (confirmed)
1) Cloud Run region: **us-east5**, service name: **travel-itinerary-app**.  
2) Expo credentials: **Expo-managed** with `EXPO_TOKEN` in GitHub.  
3) CI runner: **GitHub Actions** for API + Hosting + Expo (keep; switch to Cloud Build only if desired later).  
4) Expo web export: **replace** Hosting `public/` on each `main` merge.  
5) Firebase Admin auth: **Application Default Credentials** on Cloud Run; keys only if you must override.  
