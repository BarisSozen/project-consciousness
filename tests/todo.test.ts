import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/todo/server.js';
import type { Express } from 'express';

describe('TODO REST API', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  it('GET /todos returns empty array initially', async () => {
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /todos creates a new todo', async () => {
    const res = await request(app).post('/todos').send({ title: 'Buy milk' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, title: 'Buy milk' });
  });

  it('POST /todos without title returns 400', async () => {
    const res = await request(app).post('/todos').send({});
    expect(res.status).toBe(400);
  });

  it('GET /todos lists created todos', async () => {
    await request(app).post('/todos').send({ title: 'Task A' });
    await request(app).post('/todos').send({ title: 'Task B' });
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Task A');
    expect(res.body[1].title).toBe('Task B');
  });

  it('DELETE /todos/:id removes the todo', async () => {
    const created = await request(app).post('/todos').send({ title: 'To delete' });
    const id = created.body.id as number;
    const del = await request(app).delete(`/todos/${id}`);
    expect(del.status).toBe(200);

    const list = await request(app).get('/todos');
    expect(list.body).toHaveLength(0);
  });

  it('DELETE /todos/999 returns 404', async () => {
    const res = await request(app).delete('/todos/999');
    expect(res.status).toBe(404);
  });
});
