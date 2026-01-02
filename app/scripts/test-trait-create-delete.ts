import assert from 'assert';
import fetch from 'node-fetch';

const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
const token = process.env.TEST_USER_TOKEN || process.env.USER_TOKEN;

if (!token) {
  throw new Error('Set TEST_USER_TOKEN (or USER_TOKEN) to a valid bearer token before running this test.');
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTraits() {
  const res = await fetch(`${backendUrl}/api/traits`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch traits: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function createTrait(name: string) {
  const res = await fetch(`${backendUrl}/api/traits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create trait: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function deleteTrait(id: string) {
  const res = await fetch(`${backendUrl}/api/traits/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete trait: ${res.status} ${res.statusText} - ${text}`);
  }
}

async function run() {
  const traitName = `AutoTrait-${Date.now()}`;

  // Create
  await createTrait(traitName);
  await wait(200);
  const afterCreate = await fetchTraits();
  const created = afterCreate.find((t: any) => t.name === traitName);
  assert.ok(created, 'Trait should exist after creation');

  // Delete
  await deleteTrait(created.id);
  await wait(200);
  const afterDelete = await fetchTraits();
  const stillThere = afterDelete.find((t: any) => t.name === traitName);
  assert.ok(!stillThere, 'Trait should be gone after deletion');

  console.log('Trait create/delete test passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
