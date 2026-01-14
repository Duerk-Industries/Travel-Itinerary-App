import request from 'supertest';
import { app } from './src/app';
import { initDb, closePool } from './src/db';

async function main() {
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.NODE_ENV = 'test';
  await initDb();

  const user1 = { email: 'u1@example.com', firstName: 'U1', lastName: 'One', password: 'testtest' };
  const user2 = { email: 'u2@example.com', firstName: 'U2', lastName: 'Two', password: 'testtest' };

  let res = await request(app).post('/api/web-auth/register').send({ ...user1, passwordConfirm: user1.password });
  const token1 = res.body.token as string;

  res = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`);
  const groupId = res.body[0].id as string;

  res = await request(app).post('/api/trips').set('Authorization', `Bearer ${token1}`).send({ name: 'Trip', groupId });
  res = await request(app).post('/api/web-auth/register').send({ ...user2, passwordConfirm: user2.password });
  const token2 = res.body.token as string;

  await request(app).post(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token1}`).send({ email: user2.email });

  res = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`);
  console.log('groups1After', JSON.stringify(res.body, null, 2));
  res = await request(app).get('/api/groups').set('Authorization', `Bearer ${token2}`);
  console.log('groups2', JSON.stringify(res.body, null, 2));

  await closePool();
}

main().catch((err) => {
  console.error(err);
});
