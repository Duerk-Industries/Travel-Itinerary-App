/**
 * This file can be used to store utility functions that are shared across your tests.
 */

/**
 * A function to handle user creation and login for tests.
 * You should implement this function based on your application's authentication logic.
 * It makes API requests to register and then log in a new user.
 *
 * @returns {Promise<{userId: string, token: string}>} A promise that resolves to an object containing authentication data.
 */
export async function loginAsNewUser(): Promise<{ userId: string; token: string; username: string; email: string; }> {
  // Ensure fetch is available in the Node.js environment.
  // If you are using a Node.js version older than 18, you might need to install 'node-fetch'.
  // You can install it with: npm install node-fetch --save-dev
  // And then add `import fetch from 'node-fetch';` at the top of this file.
  if (typeof fetch === 'undefined') {
    throw new Error('The `fetch` function is not available. Please use Node.js 18+ or install `node-fetch`.');
  }

  // Generate a unique username for each test run to ensure isolation
  const username = `testuser_${Math.random().toString(36).substring(2)}`;
  const email = `${username}@example.com`;
  // Use a standard password for tests
  const password = 'password123';

  // IMPORTANT: Replace with the base URL of your API running in the test environment
  // You can set these in your .env file
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  const registerPath = process.env.API_REGISTER_PATH || '/api/auth/register';
  const loginPath = process.env.API_LOGIN_PATH || '/api/auth/login';

  // --- 1. Register a new user ---
  // The structure of this body should match what your registration endpoint expects
  const registrationBody = {
    username,
    password,
    email,
  };

  const registerResponse = await fetch(`${apiBaseUrl}${registerPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(registrationBody),
  });

  if (!registerResponse.ok) {
    const errorBody = await registerResponse.text();
    throw new Error(
      `Failed to register test user. Status: ${registerResponse.status} ${registerResponse.statusText}. URL: ${registerResponse.url}. Body: ${errorBody}`
    );
  }

  // --- 2. Log in as the new user ---
  // The structure of this body should match what your login endpoint expects
  const loginBody = { username, password };

  const loginResponse = await fetch(`${apiBaseUrl}${loginPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(loginBody),
  });

  if (!loginResponse.ok) {
    const errorBody = await loginResponse.text();
    throw new Error(
      `Failed to log in as test user. Status: ${loginResponse.status} ${loginResponse.statusText}. URL: ${loginResponse.url}. Body: ${errorBody}`
    );
  }

  // --- 3. Extract and return authentication data ---
  // The structure of the response should match what your login endpoint returns
  const authData = await loginResponse.json();

  // Example: your API might return { "token": "...", "user": { "id": "..." } }
  // Adjust these lines to match your API's response structure.
  const token = authData.token;
  const userId = authData.user?.id || authData.userId;

  if (!token || !userId) {
    throw new Error('Authentication failed: The login response did not contain a token and/or userId.');
  }

  return { userId, token, username, email };
}

export const TEST_USER_PASSWORD = 'password123';