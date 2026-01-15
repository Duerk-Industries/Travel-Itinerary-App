# Travel Itinerary App — Google Cloud + Firestore Runbook (duerk.org)

Opinionated, repo-specific steps for running this app locally with the Firestore emulator and in Google Cloud (Firestore + Cloud Run + Firebase Hosting), plus CI builds for web and Expo (iOS/Android) on `main`. Region: **us-east5**. Cloud Run service name: **travel-itinerary-app**. Auth: **Application Default Credentials (ADC)** on Cloud Run preferred.

## 1) Architecture (this repo)
- **Backend API (`travel-itinerary-app`)**: The backend is a Node.js/Express application located in the `server/` directory. It is deployed as a Google Cloud Run service named **travel-itinerary-app**. This is the service that handles all API requests (e.g., creating trips, adding flights).

- **Database (Firestore)**: The application uses Google Firestore as its database. Firestore is a flexible, scalable NoSQL document database for mobile, web, and server development from Firebase and Google Cloud. It keeps your data in sync across client apps through realtime listeners and offers offline support.

- **Frontend (Web App)**: The frontend is a React web application (built with Expo for web) located in the `app/` directory. It is not "named" in the same way as the backend service. Instead, it is built into a set of static files (HTML, CSS, JavaScript).

- **Hosting (Firebase Hosting & App Hosting)**: The static files of the frontend (Web App) are served by **Firebase Hosting**. Your custom domain, **duerk.org**, is pointed at Firebase Hosting. Firebase Hosting is responsible for serving the web app content and forwarding API requests. The term "Firebase App Hosting" refers to the integrated experience that connects your frontend (on Firebase Hosting) to your backend (on Cloud Run), and your logs indicate you are using this streamlined service. When a user visits `https://duerk.org`, they are hitting Firebase Hosting, which serves the web app. When the web app makes an API call to `/api/...`, Hosting rewrites that request and sends it to your `travel-itinerary-app` backend on Cloud Run.

- **Native App (Expo)**: The project also includes a native mobile app for iOS and Android, managed by Expo Application Services (EAS). The configuration for this is in `app.json`.

## 2) Prereqs (once)
- Google Cloud project with billing (e.g., [GCLOUD_PROJECT_ID]) and Firebase enabled.
- Tools: `gcloud`, `firebase-tools`, Node LTS, Docker, `expo-cli`/`eas` (for local builds).
- Access to Expo account `duerk-industries` and Apple/Play credentials for store uploads.

## 3) Environment config
- **Cloud Run environment variables (no `.env` in GitHub)**  
  Cloud Run does not read your repo `.env` files. Set env vars on the Cloud Run service (Console or `gcloud run deploy --set-env-vars=...`). The backend now defaults to the Firebase provider when running on Cloud Run, but you should still set env vars explicitly in production for clarity.

- **Server `.env` (hosted Firestore, ADC on Cloud Run)**  
  ```env
  PORT=4000
  DB_PROVIDER=firebase
  USE_IN_MEMORY_DB=0
  GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID]  # your project ID (or use GOOGLE_CLOUD_PROJECT on Cloud Run)
  FIRESTORE_DATABASE_ID=travel-itinerary-app-database
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
  Local-only overrides can go in `server/.local_env` (e.g., emulator hosts). It is loaded after `.env` and ignored by git. See `server/.local_env.example` for a template.

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
3) Create Firestore Database:
   - In the Google Cloud Console, use the top search bar to find and select **"Firestore"**.
   - Click the **"Create Database"** button.
   - Choose **"Native Mode"** when prompted.
   - For location, select a region. This project uses **us-east5**.
   - You will be asked about security rules. You can start with the default production rules and apply the rules from `firestore.rules` later by deploying them with the Firebase CLI (`firebase deploy --only firestore`).
   - Click **"Create"**.  
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
     --set-env-vars=DB_PROVIDER=firebase,USE_IN_MEMORY_DB=0,GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID],FIRESTORE_DATABASE_ID=travel-itinerary-app-database
   ```
   Note: Cloud Run sets `GOOGLE_CLOUD_PROJECT` automatically; the server will use it if `GCLOUD_PROJECT_ID` is not provided.
   If you use secrets for keys, add `--set-secrets=FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest`.
   Optional helper script (reads `.env` and sets env vars automatically):
   ```bash
   ./scripts/deploy-cloud-run.sh server/.env
   ```
   Defaults: service `travel-itinerary-app`, region `us-east5`, source `server/`. Set `SERVICE_NAME`, `REGION`, or `SOURCE_DIR` to override. For secrets, pass `SECRETS=NAME=SECRET:version,...` (e.g., `SECRETS=FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest`) or create a `server/.secrets` file with `KEY=VALUE` pairs to auto-create/update Secret Manager entries and map them. Use `--dry-run` to print the deploy command without executing.
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

## Linking the Squarespace Domain (duerk.org)

To connect your `duerk.org` domain from Squarespace to Firebase Hosting, you need to get DNS records from Firebase and add them to your Squarespace DNS settings. This process proves you own the domain and then points it to Firebase's servers.

### Step 1: Start the Domain Linking in Firebase

1.  Navigate to the **Firebase Console** for your project.
2.  In the left-hand menu, go to **Build > Hosting**.
3.  Click on **"Add custom domain"**.
4.  Enter `duerk.org` as the domain name and click **"Continue"**.
5.  Firebase will present you with a **TXT record**. This is for verifying that you own the domain. Copy the value of this record (it usually starts with `google-site-verification=...`).
6.  Keep this browser tab open.

### Step 2: Add DNS Records in Squarespace

1.  In a new browser tab, log in to your **Squarespace account**.
2.  From the main menu, go to **Settings**, then click **Domains**.
3.  Click on your domain, `duerk.org`.
4.  Click on **DNS Settings**. You will see a list of existing DNS records.

#### Add the Verification TXT Record

1.  In the "Custom Records" section, click **"Add Record"**.
2.  In the form fields, enter:
    *   **Host**: `@` (This represents the root domain, `duerk.org`)
    *   **Type**: `TXT`
    *   **Data**: Paste the TXT record value you copied from Firebase.
3.  Click **"Save"**.

#### Add the Firebase Hosting A Records

Firebase points your domain to its global CDN using IP addresses (A records). You must remove any existing A records on Squarespace to avoid conflicts.

1.  In the Squarespace DNS Settings panel, look for any records with the **Type** `A`. There may be one or more pointing to Squarespace's default servers. Delete these records.
2.  Go back to your Firebase Console tab. After you've verified the TXT record, Firebase will show you one or two IP addresses. These are the **A records** you need to add.
3.  In Squarespace, add the first A record:
    *   **Host**: `@`
    *   **Type**: `A`
    *   **Data**: Enter the first IP address provided by Firebase.
    *   Click **"Save"**.
4.  If Firebase provided a second IP address, repeat the process to add the second A record.

### Step 3: Finalize and Wait for Propagation

1.  After adding the records in Squarespace, go back to the Firebase Console and click **"Finish"** (or "Verify").
2.  **Wait.** DNS changes can take anywhere from a few minutes to 48 hours to fully propagate across the internet. You can use an online tool like [dnschecker.org](https://dnschecker.org/) to see if the A records are pointing to the Google IP addresses.
3.  Once propagation is complete and Firebase has verified your domain, it will automatically provision an SSL certificate. Your site `https://duerk.org` will then be live and secure. The API proxy to `/api/**` will also be active.

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
- **Build script note (Firebase/App Hosting)**: the root `build`/`start` scripts use `npm --prefix server run ...` instead of `npm run -w server ...` to avoid workspace recursion in environments that don't support the `-w` flag.

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
              --set-env-vars=DB_PROVIDER=firebase,USE_IN_MEMORY_DB=0,GCLOUD_PROJECT_ID=[GCLOUD_PROJECT_ID],FIRESTORE_DATABASE_ID=travel-itinerary-app-database
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
