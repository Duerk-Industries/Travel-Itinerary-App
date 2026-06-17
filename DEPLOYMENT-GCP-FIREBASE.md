# Travel Itinerary App — Deployment Runbook (duerk.org)

Back to the project home: [README](README.md)

Related docs:

- [Documentation Hub](docs/README.md)
- [FAQ](FAQ.md)
- [GCP Email Ingest Setup](docs/gcp-email-ingest-setup.md)

This document provides a complete guide for deploying and maintaining the Travel Itinerary App on Google Cloud and Firebase.

## 1. System Architecture

The application consists of a React/Expo frontend (for web and native mobile apps) and a Node.js/Express backend API, using Firestore as the database.

*   **Backend API**: A Node.js/Express app in `server/` is deployed as a **Google Cloud Run** service.
*   **Frontend Web App**: A React web app (built from the `app/` directory) is deployed to **Firebase Hosting**.
*   **Database**: A **Firestore** database hosts all application data.
*   **Native Mobile Apps**: iOS and Android apps are built using **Expo Application Services (EAS)**.

### How It All Connects

The custom domain `duerk.org` is the single entry point for all users. Firebase Hosting and Cloud Run work together to route requests.

**Web App Request Flow:**
1.  A user visits `https://duerk.org`.
2.  **Firebase Hosting** receives the request and serves the static frontend assets (HTML, CSS, JavaScript) that make up the React web application.
3.  The React app, now running in the user's browser, makes an API call to a path like `https://duerk.org/api/trips`.
4.  **Firebase Hosting** intercepts this request. A **rewrite rule** in `firebase.json` matches the `/api/**` pattern and forwards the request to the **Cloud Run** backend service.
5.  The **Cloud Run** service processes the request (e.g., queries the Firestore database) and returns a JSON response.

**Native App (Expo) Request Flow:**
1.  The native app is installed on a user's device.
2.  The app's code is configured to make API calls directly to the production backend endpoint: `https://duerk.org/api`.
3.  When the app needs data, it makes a standard HTTPS request to `https://duerk.org/api/trips`.
4.  Just like the web app, the request hits **Firebase Hosting**, which triggers the rewrite rule, forwarding the request to the **Cloud Run** backend.

This setup ensures both the web and native apps use the same backend API, hosted under a single, consistent domain.

---


## 2. One-Time Project Setup

These steps only need to be performed once per Google Cloud project.

### Fast Path: Run Everything Once
If you already have your values in `server/.env`, you can run the full setup in one command:

```bash
./scripts/setup-all.sh
```

Use `--skip-login` if you are already authenticated with gcloud.

### Step 1: Configure gcloud CLI
This script will guide you through logging into Google Cloud and setting your default project.

```bash
# Usage: ./scripts/configure-gcloud.sh <YOUR_GCLOUD_PROJECT_ID>
./scripts/configure-gcloud.sh your-project-id-here
```

### Step 2: Enable Required GCP Services
This script enables the necessary APIs for Cloud Run, Secret Manager, and Firestore.

```bash
./scripts/enable-gcp-apis.sh
```

### Step 3: Create Firestore Database
This step is done manually in the Google Cloud Console.
1.  In the Cloud Console, search for and select **"Firestore"**.
2.  Click **"Create Database"** and choose **"Native Mode"**.
3.  Select a location (this project uses **us-east5**).
4.  Click **"Create"**. You can apply the security rules from `firestore.rules` later.

### Step 4: Configure IAM Permissions

This step uses a dedicated script to grant all necessary permissions for a secure, automated deployment pipeline. It follows the principle of least privilege by defining three distinct service accounts:

*   **Deployer Service Account**: Used by the CI/CD system (GitHub Actions) to authenticate with Google Cloud and trigger builds.
*   **Cloud Build Service Account**: The default service account used by Google Cloud Build to execute the build and deployment process.
*   **Runtime Service Account**: The identity that the Cloud Run service runs as, granting it access to other Google Cloud resources like Firestore.

1.  **Define Service Accounts in `server/.env`**:

    Create or open the `server/.env` file and add the following required variables. This file is git-ignored and should not be committed. `server/.secrets` is still supported as a fallback, but `server/.env` is now the primary local source for both regular env vars and secrets.

    ```bash
    # The ID of your Google Cloud project.
    GCLOUD_PROJECT_ID="your-project-id-here"

    # The unique number of your Google Cloud project.
    # Find this on the GCP Console Dashboard.
    GCLOUD_PROJECT_NUMBER="123456789012"

    # The email of the service account used for deployment (e.g., from GitHub Actions).
    # This account will be granted permissions to trigger builds and manage secrets.
    DEPLOYER_SERVICE_ACCOUNT_EMAIL="your-deployer-sa@your-project-id.iam.gserviceaccount.com"

    # (Optional) The email of the service account the Cloud Run service will run as.
    # If commented out, it defaults to the Compute Engine default service account.
    # RUNTIME_SERVICE_ACCOUNT_EMAIL="123456789012-compute@developer.gserviceaccount.com"
    ```

2.  **Run the IAM Configuration Script**:

    Execute the script from the root directory. It will read the variables from `server/.env` first, with `server/.secrets` still supported as a fallback, and apply the correct IAM role bindings to all three service accounts. The script is idempotent, so it's safe to run multiple times.

    ```bash
    ./scripts/setup-iam-permissions.sh
    ```

---


## 3. Local Development

1.  `npm install` in the root, `server/`, and `app/` directories.
2.  **Configure Local Environment**: The server uses a `server/.local_env` file for local-only settings. Create this file by copying `server/.local_env.example`.
    ```bash
    cp server/.local_env.example server/.local_env
    ```
    By default, `server/.local_env` is configured to use the Firebase emulator (`USE_FIRESTORE_EMULATOR=true`).

3.  **Start Emulators**: In one terminal, start the Firebase emulators.
    ```bash
    firebase emulators:start
    ```
4.  **Run the API**: In another terminal, run the API server.
    ```bash
    cd server && npm run dev
    ```
5.  **Run the Expo App**: In a third terminal, run the frontend application.
    ```bash
    cd app && npm start
    ```

---


## 4. Deployment Workflow

Deploying the application is a three-step process: build the frontend, configure the backend environment, and deploy the services.

### Step 1: Build the Frontend Web App
Before deploying to Firebase Hosting, you must create a production build of the web app.

```bash
# From the root directory:
npx expo export --platform web --output-dir ./dist
```
This command compiles the web app and places the static files into the `dist/` directory, which is what Firebase Hosting serves.

### Step 2: Configure the Backend Environment
Your backend's configuration is managed through environment variables and secrets.

*   **`server/.env`**: Primary local source for both non-sensitive configuration and secrets. `GCLOUD_PROJECT_ID` is required, and Cloud Run deploys also require a non-default `AUTH_SECRET` unless you map `AUTH_SECRET` from Secret Manager via `server/.secrets` or `SECRETS`.
*   **`server/.secrets`**: Optional fallback file for backwards compatibility. It is still read by loaders and deploy scripts, but is no longer the primary local source.

Run the following script to upload these variables and secrets to your Cloud Run service. It will create secrets in Google Secret Manager if they don't exist and then securely map them to your service.

```bash
# This script reads from server/.env by default and still supports server/.secrets as a fallback.
./scripts/configure-run-env.sh
```

### Step 3: Deploy the Application
With the environment configured, you can now deploy the code.

**Deploy the Backend API:**
This script deploys the code from the `server/` directory to Cloud Run using `gcloud run deploy --source`, which automatically triggers a build on Cloud Build.
```bash
./scripts/deploy-api.sh
```

**Deploy the Frontend Web App:**
This script uploads the contents of the `dist/` directory to Firebase Hosting.
```bash
./scripts/deploy-hosting.sh
```

---


## 5. Automated Deployment Strategy

This project uses **GitHub Actions** as the primary mechanism for automated deployments. Pushing to the `main` branch will trigger the workflows defined in the `.github/workflows` directory.

### Native Cloud Build Triggers
The `trigger.yaml` file in the root directory is a sample configuration for a native Google Cloud Build trigger. This file is provided for reference but is not active.

**Important**: To avoid running redundant builds, ensure that only one automated deployment method is active. This project is configured to use the GitHub Actions workflows. If you have a native Cloud Build trigger configured in your GCP project that also deploys on pushes to `main`, you should disable it.

---

## 6. Automated Deployments with GitHub Actions (CI/CD)

**Workflows**
*   Backend API: `.github/workflows/deploy-api.yml`
*   Firebase Hosting (prod): `.github/workflows/firebase-hosting-merge.yml`
*   Firebase Hosting (PR preview): `.github/workflows/firebase-hosting-pull-request.yml`

**GitHub Secrets**

Navigate to your repository's `Settings > Secrets and variables > Actions` to configure the following:

*   **`GCP_SERVICE_ACCOUNT_KEY`**: The JSON key for the **Deployer Service Account** defined as `DEPLOYER_SERVICE_ACCOUNT_EMAIL` in your `server/.env` file. The `./scripts/setup-iam-permissions.sh` script grants it the necessary roles to trigger builds and deploy Cloud Run:
    *   `Cloud Run Admin`
    *   `Cloud Build Editor`
    *   `Service Account User` (on the runtime service account)

*   **`GCLOUD_PROJECT_ID`**: The ID of your Google Cloud project (e.g., `REDACTED`).

*   **`FIREBASE_SERVICE_ACCOUNT_TRAVEL_ITINERARY_APP_483623`**: A JSON service account key with permissions to deploy to Firebase Hosting. You can generate this by running `firebase login:ci` and following the prompts.

*   **`EXPO_TOKEN`**: Your Expo Access Token, used for publishing updates and running builds with EAS via the `eas-build.yml` workflow.

---


## 7. CI/CD and Cloud Build Checklist

Use this list to validate configuration before you rely on automated deployments:

*   `server/.env` contains `GCLOUD_PROJECT_ID`, `GCLOUD_PROJECT_NUMBER`, and `DEPLOYER_SERVICE_ACCOUNT_EMAIL`.
*   `./scripts/setup-iam-permissions.sh` runs successfully (safe to re-run) and grants the deployer `roles/run.admin` plus `roles/iam.serviceAccountUser` on the runtime service account.
*   The Cloud Build service account has `roles/artifactregistry.writer` if you deploy with `gcloud run deploy --source`.
*   GitHub Secrets include `GCP_SERVICE_ACCOUNT_KEY`, `GCLOUD_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_TRAVEL_ITINERARY_APP_483623`, and `EXPO_TOKEN`.
*   The Hosting workflows build the Expo web output into `dist/`, which matches `firebase.json` hosting `public`.

---


## 8. Connecting a Custom Domain

To connect your domain (e.g., `duerk.org`) to Firebase Hosting:

1.  **In the Firebase Console**, go to **Hosting** and click **"Add custom domain"**.
2.  Enter your domain name. Firebase will provide you with a **TXT record** for verification and two **A records** (IP addresses).
3.  **At your domain registrar**, go to your domain's DNS settings.
    *   Add the **TXT record** to prove ownership.
    *   **Delete any existing A records** for your root domain.
    *   Add the two **A records** provided by Firebase.
4.  **Wait** for DNS to propagate, then click **"Verify"** in the Firebase console. Firebase will automatically provision an SSL certificate.

---


## 9. Testing the Deployment

After a deployment, perform these checks to ensure everything is working.

*   **Test the API**: Use `curl` to hit an API endpoint. You should get a valid response, not a 5xx server error or a 404.
    ```bash
    # This endpoint should return a 401 Unauthorized error, which is correct.
    curl -i https://duerk.org/api/web-auth/login
    ```
*   **Test the Web App**: Open `https://duerk.org` in your browser. The app should load, and you should be able to interact with it (e.g., log in, view trips). Check the browser's developer console for any errors.
*   **Check Firestore**: Create or modify data using the app and verify that the changes appear in the **Firestore Console**.
*   **Verify Native App Connectivity**: Open a development build of the native app or a new build from EAS. Ensure it can successfully fetch and update data from the `https://duerk.org/api` backend.

---


## 10. Other Topics

### SMTP/Email Setup
(Content from previous version remains here)
...
