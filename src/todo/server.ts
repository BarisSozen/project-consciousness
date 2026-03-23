import express, { Request, Response } from 'express';

interface Todo {
  id: number;
  title: string;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  let todos: Todo[] = [];
  let nextId = 1;

  app.get('/todos', (_req: Request, res: Response) => {
    res.json(todos);
  });

  app.post('/todos', (req: Request, res: Response) => {
    const { title } = req.body as { title?: string };
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const todo: Todo = { id: nextId++, title };
    todos.push(todo);
    res.status(201).json(todo);
  });

  app.delete('/todos/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    todos.splice(index, 1);
    res.status(200).json({ deleted: id });
  });

  return app;
}
