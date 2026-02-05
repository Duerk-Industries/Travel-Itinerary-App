import request from 'supertest';
import express from 'express';
import groupsRouter from '../groups';
import { detectCycle } from '../utils/coveredBy';

// Mock dependencies
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
}));

const mockUpdateGroup = jest.fn();
jest.mock('../database', () => ({
  db: {
    updateGroup: async (...args) => mockUpdateGroup(...args),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/groups', groupsRouter);

describe('PUT /api/groups/:groupId/covered-by', () => {
  beforeEach(() => {
    mockUpdateGroup.mockClear();
  });

  it('should reject a payload with a simple cycle and return 400', async () => {
    const cyclicPayload = { m1: 'm2', m2: 'm1' };

    const res = await request(app)
      .put('/api/groups/test-group/covered-by')
      .send(cyclicPayload);

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('circular dependency');
    expect(mockUpdateGroup).not.toHaveBeenCalled();
  });

  it('should accept a valid payload and return 200', async () => {
    const validPayload = { m1: 'm3', m2: 'm3' };

    const res = await request(app)
      .put('/api/groups/test-group/covered-by')
      .send(validPayload);

    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toContain('updated successfully');
    expect(mockUpdateGroup).toHaveBeenCalledWith('test-group', { coveredBy: validPayload });
  });
});
