Build a REST API for a task management system.

Entities:
- User (name, email, password)
- Project (title, description, ownerId)
- Task (title, description, status, priority, projectId, assigneeId, dueDate)

Relationships:
- Each User can own multiple Projects
- Each Project has multiple Tasks
- Each Task is assigned to one User

Auth: JWT. Users must register and login.
Authorization: Only project owner can create/delete tasks in their project.
Assignee can update task status only.

Database: SQLite with Drizzle ORM.
Validation: Zod for all inputs.

Endpoints:
POST /auth/register, POST /auth/login
GET /projects, POST /projects, GET /projects/:id, DELETE /projects/:id
GET /projects/:projectId/tasks, POST /projects/:projectId/tasks
PUT /tasks/:id (status update by assignee, full update by owner)
DELETE /tasks/:id (owner only)

Stack: TypeScript, Express, SQLite, Drizzle, Zod, Vitest.
API-only backend, no frontend.

Success criteria:
- All endpoints return correct JSON responses
- Auth middleware blocks unauthorized access
- Owner vs assignee permissions enforced
- Input validation rejects invalid data
- All tests pass
