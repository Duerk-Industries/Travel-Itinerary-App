import request from 'supertest';
import { app } from '../src/app';

export const login = async (email, password) => {
  const response = await request(app)
    .post('/api/web-auth/login')
    .send({ email, password });
  return response.body.token;
};
