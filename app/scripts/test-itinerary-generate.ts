import assert from 'assert';
import fetch from 'node-fetch';

const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
const token = process.env.TEST_USER_TOKEN || process.env.USER_TOKEN;

if (!token) {
  throw new Error('Set TEST_USER_TOKEN (or USER_TOKEN) to a valid bearer token before running this test.');
}

async function run() {
  const payload = {
    country: 'United States',
    days: 3,
    budgetMin: 500,
    budgetMax: 2000,
    departureAirport: 'JFK',
    tripStyle: 'Test automation trip',
  };

  const res = await fetch(`${backendUrl}/api/itinerary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Itinerary generation failed: ${res.status} ${res.statusText} - ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  const plan = data.plan || '';
  assert.ok(plan && typeof plan === 'string' && plan.trim().length > 0, 'Plan should be a non-empty string');

  console.log('Itinerary generation test passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
