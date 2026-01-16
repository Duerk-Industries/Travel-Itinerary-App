# Travel Itinerary App — Deployment Runbook (duerk.org)

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

### Step 4: Set IAM Permissions for Cloud Run
This script grants the default Cloud Run service account the necessary permissions to access Firestore and Secret Manager.

```bash
# Usage: ./scripts/setup-iam-permissions.sh <PROJECT_ID> <PROJECT_NUMBER>
# You can find the Project Number on the Google Cloud Console Dashboard.
./scripts/setup-iam-permissions.sh your-project-id-here 123456789012
```

---


## 3. Local Development

1.  `npm install` in the root, `server/`, and `app/` directories.
2.  Start emulators: `firebase emulators:start`.
3.  Run the API: `cd server && npm run dev`.
4.  Run the Expo app: `cd app && npm start`.

---


## 4. Deployment Workflow

Deploying the application is a three-step process: build the frontend, configure the backend environment, and deploy the services.

### Step 1: Build the Frontend Web App
Before deploying to Firebase Hosting, you must create a production build of the web app.

```bash
# From the root directory:
npx expo export --platform web --output-dir ./dist
```
This command compiles the web app and places the static files into the `public/` directory, which is what Firebase Hosting serves.

### Step 2: Configure the Backend Environment
Your backend's configuration (database connections, API keys) is managed through environment variables and secrets.

*   **`server/.env`**: Contains non-sensitive configuration. A `GCLOUD_PROJECT_ID` entry is required.
*   **`server/.secrets`**: Contains sensitive values like API keys or passwords. This file should be in your `.gitignore`. Create it from `server/.secrets.example`.

Run the following script to upload these variables and secrets to your Cloud Run service. It will create secrets in Google Secret Manager if they don't exist and then securely map them to your service.

```bash
# This script reads from server/.env and server/.secrets by default.
./scripts/configure-run-env.sh
```

### Step 3: Deploy the Application
With the environment configured, you can now deploy the code.

**Deploy the Backend API:**
This script deploys the code from the `server/` directory to Cloud Run.
```bash
./scripts/deploy-api.sh
```

**Deploy the Frontend Web App:**
This script uploads the contents of the `public/` directory to Firebase Hosting.
```bash
./scripts/deploy-hosting.sh
```

---


## 5. Automated Deployments with GitHub Actions (CI/CD)

You can automate the entire deployment workflow to run every time you push a change to the `main` branch.

1.  **Secrets**: Add the following secrets to your GitHub repository's settings (`Settings > Secrets and variables > Actions`):
    *   `GCP_SERVICE_ACCOUNT_KEY`: A JSON key for a Google Cloud service account with permissions to deploy to Cloud Run and Hosting (`roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/firebase.admin`).
    *   `GCLOUD_PROJECT_ID`: Your Google Cloud project ID.
    *   `EXPO_TOKEN`: Your Expo access token for EAS builds.

2.  **Workflows**: Add the following workflow files to your `.github/workflows/` directory.

**Backend API Deployment (`deploy-api.yml`):**
```yaml
name: Deploy API to Cloud Run

on:
  push:
    branches:
      - main

jobs:
  deploy:
    name: Deploy API
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy API
        run: |-
          gcloud run deploy travel-itinerary-app \
            --source ./server \
            --region us-east5 \
            --project ${{ secrets.GCLOUD_PROJECT_ID }}
```

**Frontend Web App Deployment (`deploy-hosting.yml`):**
```yaml
name: Deploy Web App to Firebase Hosting

on:
  push:
    branches:
      - main

jobs:
  build_and_deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install Dependencies
        run: npm install

      - name: Build Web App
        run: npx expo export --platform web --output-dir ./dist

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}
          projectId: ${{ secrets.GCLOUD_PROJECT_ID }}
          channelId: live
```

---


## 6. Connecting a Custom Domain

To connect your domain (e.g., `duerk.org`) to Firebase Hosting:

1.  **In the Firebase Console**, go to **Hosting** and click **"Add custom domain"**.
2.  Enter your domain name. Firebase will provide you with a **TXT record** for verification and two **A records** (IP addresses).
3.  **At your domain registrar** (GoDaddy, Namecheap, etc.), go to your domain's DNS settings.
    *   Add the **TXT record** to prove ownership.
    *   **Delete any existing A records** for your root domain.
    *   Add the two **A records** provided by Firebase.
4.  **Wait** for DNS to propagate, then click **"Verify"** in the Firebase console. Firebase will automatically provision an SSL certificate.

---


## 7. Testing the Deployment

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


## 8. Other Topics

### Deprecated Scripts
The scripts `deploy-cloud-run.sh` and `configure-cloud-run-env.sh` are now deprecated. Please use the new, more focused scripts:
*   `configure-run-env.sh`
*   `deploy-api.sh`
*   `deploy-hosting.sh`

### SMTP/Email Setup
(Content from previous version remains here)
...
