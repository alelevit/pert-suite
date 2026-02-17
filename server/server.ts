import express from 'express';
import cors from 'cors';
import pg from 'pg';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// ──────────────────────────────────────
// Database
// ──────────────────────────────────────

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                tasks JSONB DEFAULT '[]',
                start_date TEXT,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                completed BOOLEAN DEFAULT false,
                completed_at BIGINT,
                due_date TEXT,
                scheduled_date TEXT,
                duration_days INTEGER,
                priority TEXT DEFAULT 'none',
                labels JSONB DEFAULT '[]',
                section TEXT DEFAULT 'inbox',
                recurrence JSONB,
                pert_project_id TEXT,
                pert_task_id TEXT,
                pert_project_name TEXT,
                parent_id TEXT,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        console.log('✅ Database tables initialized');
    } finally {
        client.release();
    }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

// ──────────────────────────────────────
// Types
// ──────────────────────────────────────

interface SavedProject {
    id: string;
    name: string;
    description: string;
    tasks: unknown[];
    startDate?: string;
    createdAt: number;
    updatedAt: number;
}

interface TodoTask {
    id: string;
    title: string;
    description?: string;
    completed: boolean;
    completedAt?: number;
    dueDate?: string;
    scheduledDate?: string;
    durationDays?: number;
    priority: 'p1' | 'p2' | 'p3' | 'none';
    labels: string[];
    section: string;
    recurrence?: {
        pattern: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
        interval?: number;
        daysOfWeek?: number[];
    };
    pertProjectId?: string;
    pertTaskId?: string;
    pertProjectName?: string;
    parentId?: string;
    createdAt: number;
    updatedAt: number;
}

// ──────────────────────────────────────
// Helpers
// ──────────────────────────────────────

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// Convert DB row (snake_case) to API object (camelCase) for projects
function rowToProject(row: any): SavedProject {
    return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        tasks: row.tasks || [],
        startDate: row.start_date || undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

// Convert DB row (snake_case) to API object (camelCase) for todos
function rowToTodo(row: any): TodoTask {
    return {
        id: row.id,
        title: row.title,
        description: row.description || undefined,
        completed: row.completed,
        completedAt: row.completed_at ? Number(row.completed_at) : undefined,
        dueDate: row.due_date || undefined,
        scheduledDate: row.scheduled_date || undefined,
        durationDays: row.duration_days || undefined,
        priority: row.priority || 'none',
        labels: row.labels || [],
        section: row.section || 'inbox',
        recurrence: row.recurrence || undefined,
        pertProjectId: row.pert_project_id || undefined,
        pertTaskId: row.pert_task_id || undefined,
        pertProjectName: row.pert_project_name || undefined,
        parentId: row.parent_id || undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

// ──────────────────────────────────────
// Project Routes
// ──────────────────────────────────────

// GET /api/projects — list all projects
app.get('/api/projects', async (_req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY updated_at DESC');
        res.json(result.rows.map(rowToProject));
    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET /api/projects/:id — get single project
app.get('/api/projects/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json(rowToProject(result.rows[0]));
    } catch (err) {
        console.error('Error fetching project:', err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// POST /api/projects — create new project
app.post('/api/projects', async (req, res) => {
    try {
        const now = Date.now();
        const project: SavedProject = {
            id: generateId(),
            name: req.body.name || 'Untitled Project',
            description: req.body.description || '',
            tasks: req.body.tasks || [],
            startDate: req.body.startDate,
            createdAt: now,
            updatedAt: now,
        };
        await pool.query(
            `INSERT INTO projects (id, name, description, tasks, start_date, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [project.id, project.name, project.description, JSON.stringify(project.tasks), project.startDate || null, project.createdAt, project.updatedAt]
        );
        res.status(201).json(project);
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// PUT /api/projects/:id — upsert project
app.put('/api/projects/:id', async (req, res) => {
    try {
        const now = Date.now();
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
        if (result.rows.length > 0) {
            const existing = rowToProject(result.rows[0]);
            const updated = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: now };
            await pool.query(
                `UPDATE projects SET name=$1, description=$2, tasks=$3, start_date=$4, updated_at=$5 WHERE id=$6`,
                [updated.name, updated.description, JSON.stringify(updated.tasks), updated.startDate || null, updated.updatedAt, updated.id]
            );
            res.json(updated);
        } else {
            const project = {
                ...req.body,
                id: req.params.id,
                createdAt: req.body.createdAt || now,
                updatedAt: req.body.updatedAt || now,
            };
            await pool.query(
                `INSERT INTO projects (id, name, description, tasks, start_date, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [project.id, project.name || '', project.description || '', JSON.stringify(project.tasks || []), project.startDate || null, project.createdAt, project.updatedAt]
            );
            res.status(201).json(project);
        }
    } catch (err) {
        console.error('Error upserting project:', err);
        res.status(500).json({ error: 'Failed to upsert project' });
    }
});

// DELETE /api/projects/:id — delete project
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// POST /api/projects/import — import a single project
app.post('/api/projects/import', async (req, res) => {
    try {
        const data = req.body;
        if (!data.name || !Array.isArray(data.tasks)) {
            res.status(400).json({ error: 'Invalid project format: needs name and tasks array' });
            return;
        }
        const now = Date.now();
        const project: SavedProject = {
            id: generateId(),
            name: data.name + ' (Imported)',
            description: data.description || '',
            tasks: data.tasks,
            createdAt: data.createdAt || now,
            updatedAt: now,
        };
        await pool.query(
            `INSERT INTO projects (id, name, description, tasks, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [project.id, project.name, project.description, JSON.stringify(project.tasks), project.createdAt, project.updatedAt]
        );
        res.status(201).json(project);
    } catch (err) {
        console.error('Error importing project:', err);
        res.status(400).json({ error: 'Failed to import project' });
    }
});

// POST /api/projects/migrate — bulk import from localStorage
app.post('/api/projects/migrate', async (req, res) => {
    try {
        const { projects } = req.body as { projects: SavedProject[] };
        if (!Array.isArray(projects)) {
            res.status(400).json({ error: 'Expected { projects: [...] }' });
            return;
        }
        const migrated: SavedProject[] = [];
        for (const p of projects) {
            const project: SavedProject = {
                id: p.id || generateId(),
                name: p.name || 'Untitled',
                description: p.description || '',
                tasks: p.tasks || [],
                createdAt: p.createdAt || Date.now(),
                updatedAt: p.updatedAt || Date.now(),
            };
            await pool.query(
                `INSERT INTO projects (id, name, description, tasks, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, tasks=$4, updated_at=$6`,
                [project.id, project.name, project.description, JSON.stringify(project.tasks), project.createdAt, project.updatedAt]
            );
            migrated.push(project);
        }
        res.status(201).json({ migrated: migrated.length, projects: migrated });
    } catch (err) {
        console.error('Error migrating projects:', err);
        res.status(400).json({ error: 'Migration failed' });
    }
});

// ──────────────────────────────────────
// Todo Helper
// ──────────────────────────────────────

async function insertTodo(todo: TodoTask) {
    await pool.query(
        `INSERT INTO todos (id, title, description, completed, completed_at, due_date, scheduled_date, duration_days, priority, labels, section, recurrence, pert_project_id, pert_task_id, pert_project_name, parent_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [todo.id, todo.title, todo.description || null, todo.completed, todo.completedAt || null, todo.dueDate || null, todo.scheduledDate || null, todo.durationDays || null, todo.priority, JSON.stringify(todo.labels), todo.section, todo.recurrence ? JSON.stringify(todo.recurrence) : null, todo.pertProjectId || null, todo.pertTaskId || null, todo.pertProjectName || null, todo.parentId || null, todo.createdAt, todo.updatedAt]
    );
}

async function updateTodo(todo: TodoTask) {
    await pool.query(
        `UPDATE todos SET title=$1, description=$2, completed=$3, completed_at=$4, due_date=$5, scheduled_date=$6, duration_days=$7, priority=$8, labels=$9, section=$10, recurrence=$11, pert_project_id=$12, pert_task_id=$13, pert_project_name=$14, parent_id=$15, updated_at=$16 WHERE id=$17`,
        [todo.title, todo.description || null, todo.completed, todo.completedAt || null, todo.dueDate || null, todo.scheduledDate || null, todo.durationDays || null, todo.priority, JSON.stringify(todo.labels), todo.section, todo.recurrence ? JSON.stringify(todo.recurrence) : null, todo.pertProjectId || null, todo.pertTaskId || null, todo.pertProjectName || null, todo.parentId || null, todo.updatedAt, todo.id]
    );
}

function getNextRecurrenceDate(todo: TodoTask): string {
    const today = new Date();
    const rec = todo.recurrence!;
    const interval = rec.interval || 1;

    switch (rec.pattern) {
        case 'daily':
            today.setDate(today.getDate() + interval);
            break;
        case 'weekdays': {
            let d = new Date(today);
            d.setDate(d.getDate() + 1);
            while (d.getDay() === 0 || d.getDay() === 6) {
                d.setDate(d.getDate() + 1);
            }
            return d.toISOString().split('T')[0];
        }
        case 'weekly':
            today.setDate(today.getDate() + 7 * interval);
            break;
        case 'monthly':
            today.setMonth(today.getMonth() + interval);
            break;
        default:
            today.setDate(today.getDate() + 1);
    }
    return today.toISOString().split('T')[0];
}

// ──────────────────────────────────────
// Todo Routes
// ──────────────────────────────────────

const TODO_SORT = `ORDER BY
    CASE priority WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 WHEN 'p3' THEN 2 ELSE 3 END,
    created_at ASC`;

// GET /api/todos — list todos (with optional filters)
app.get('/api/todos', async (req, res) => {
    try {
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (req.query.date) {
            conditions.push(`(scheduled_date = $${idx} OR due_date = $${idx})`);
            params.push(req.query.date);
            idx++;
        }
        if (req.query.section) {
            conditions.push(`section = $${idx}`);
            params.push(req.query.section);
            idx++;
        }
        if (req.query.completed !== undefined) {
            conditions.push(`completed = $${idx}`);
            params.push(req.query.completed === 'true');
            idx++;
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const result = await pool.query(`SELECT * FROM todos ${where} ${TODO_SORT}`, params);
        res.json(result.rows.map(rowToTodo));
    } catch (err) {
        console.error('Error fetching todos:', err);
        res.status(500).json({ error: 'Failed to fetch todos' });
    }
});

// GET /api/todos/sections — list unique section names
app.get('/api/todos/sections', async (_req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT section FROM todos WHERE completed = false ORDER BY section');
        res.json(result.rows.map(r => r.section));
    } catch (err) {
        console.error('Error fetching sections:', err);
        res.status(500).json({ error: 'Failed to fetch sections' });
    }
});

// GET /api/todos/today — get today's tasks
app.get('/api/todos/today', async (_req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        // Get all non-completed todos that are scheduled/due today or earlier,
        // plus completed todos from today
        const result = await pool.query(`SELECT * FROM todos ${TODO_SORT}`);
        const allTodos = result.rows.map(rowToTodo);

        const todayTodos = allTodos.filter(t => {
            if (t.completed && t.completedAt) {
                const completedDate = new Date(t.completedAt).toISOString().split('T')[0];
                return completedDate === today;
            }
            if (t.completed) return false;
            if (t.scheduledDate && t.scheduledDate <= today) return true;
            if (t.dueDate && t.dueDate <= today) return true;
            if (t.recurrence && (t.recurrence.pattern === 'daily' || t.recurrence.pattern === 'weekdays')) {
                if (t.recurrence.pattern === 'weekdays') {
                    const day = new Date().getDay();
                    return day >= 1 && day <= 5;
                }
                return true;
            }
            return false;
        });

        res.json(todayTodos);
    } catch (err) {
        console.error('Error fetching today todos:', err);
        res.status(500).json({ error: 'Failed to fetch today todos' });
    }
});

// GET /api/todos/upcoming — todos scheduled for the future
app.get('/api/todos/upcoming', async (_req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            `SELECT * FROM todos WHERE completed = false
             AND (scheduled_date > $1 OR due_date > $1)
             ORDER BY COALESCE(scheduled_date, due_date) ASC`,
            [today]
        );
        res.json(result.rows.map(rowToTodo));
    } catch (err) {
        console.error('Error fetching upcoming todos:', err);
        res.status(500).json({ error: 'Failed to fetch upcoming todos' });
    }
});

// POST /api/todos — create new todo
app.post('/api/todos', async (req, res) => {
    try {
        const now = Date.now();
        const todo: TodoTask = {
            id: generateId(),
            title: req.body.title || 'Untitled',
            description: req.body.description,
            completed: false,
            dueDate: req.body.dueDate,
            scheduledDate: req.body.scheduledDate,
            durationDays: req.body.durationDays,
            priority: req.body.priority || 'none',
            labels: req.body.labels || [],
            section: req.body.section || 'inbox',
            recurrence: req.body.recurrence,
            pertProjectId: req.body.pertProjectId,
            pertTaskId: req.body.pertTaskId,
            pertProjectName: req.body.pertProjectName,
            parentId: req.body.parentId,
            createdAt: now,
            updatedAt: now,
        };
        await insertTodo(todo);
        res.status(201).json(todo);
    } catch (err) {
        console.error('Error creating todo:', err);
        res.status(500).json({ error: 'Failed to create todo' });
    }
});

// PUT /api/todos/:id — upsert (update or create) todo
app.put('/api/todos/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM todos WHERE id = $1', [req.params.id]);
        if (result.rows.length > 0) {
            const existing = rowToTodo(result.rows[0]);
            const updated: TodoTask = {
                ...existing,
                ...req.body,
                id: existing.id,
                createdAt: existing.createdAt,
                updatedAt: Date.now(),
            };
            await updateTodo(updated);
            res.json(updated);
        } else {
            const todo: TodoTask = {
                ...req.body,
                id: req.params.id,
                createdAt: req.body.createdAt || Date.now(),
                updatedAt: req.body.updatedAt || Date.now(),
            };
            await insertTodo(todo);
            res.status(201).json(todo);
        }
    } catch (err) {
        console.error('Error upserting todo:', err);
        res.status(500).json({ error: 'Failed to upsert todo' });
    }
});

// DELETE /api/todos/:id — delete todo
app.delete('/api/todos/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM todos WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Todo not found' });
            return;
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting todo:', err);
        res.status(500).json({ error: 'Failed to delete todo' });
    }
});

// POST /api/todos/:id/complete — mark complete (handles recurrence)
app.post('/api/todos/:id/complete', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM todos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Todo not found' });
            return;
        }

        const todo = rowToTodo(result.rows[0]);
        todo.completed = true;
        todo.completedAt = Date.now();
        todo.updatedAt = Date.now();
        await updateTodo(todo);

        let nextTodo: TodoTask | undefined;

        if (todo.recurrence) {
            const nextDate = getNextRecurrenceDate(todo);
            nextTodo = {
                id: generateId(),
                title: todo.title,
                description: todo.description,
                completed: false,
                dueDate: todo.dueDate ? nextDate : undefined,
                scheduledDate: nextDate,
                priority: todo.priority,
                labels: [...todo.labels],
                section: todo.section,
                recurrence: { ...todo.recurrence },
                pertProjectId: todo.pertProjectId,
                pertTaskId: todo.pertTaskId,
                pertProjectName: todo.pertProjectName,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await insertTodo(nextTodo);
        }

        res.json({ completed: todo, next: nextTodo });
    } catch (err) {
        console.error('Error completing todo:', err);
        res.status(500).json({ error: 'Failed to complete todo' });
    }
});

// ──────────────────────────────────────
// Export PERT Project → Todos
// ──────────────────────────────────────

interface PertTaskForExport {
    id: string;
    name: string;
    optimistic: number;
    likely: number;
    pessimistic: number;
    dependencies: string[];
    earlyStart?: number;
    earlyFinish?: number;
    duration?: number;
}

app.post('/api/projects/:id/export-todos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        const project = rowToProject(result.rows[0]);
        const { startDate } = req.body as { startDate?: string };
        const pertTasks = (req.body.tasks || project.tasks) as PertTaskForExport[];
        const projectName = project.name;
        const baseDate = startDate ? new Date(startDate + 'T00:00:00') : new Date();
        const createdTodos: TodoTask[] = [];

        for (const task of pertTasks) {
            const expectedDuration = (task.optimistic + 4 * task.likely + task.pessimistic) / 6;
            const earlyStart = task.earlyStart ?? 0;
            const earlyFinish = task.earlyFinish ?? (earlyStart + expectedDuration);

            const taskStart = new Date(baseDate);
            taskStart.setDate(taskStart.getDate() + Math.round(earlyStart));

            const taskEnd = new Date(baseDate);
            taskEnd.setDate(taskEnd.getDate() + Math.round(earlyFinish));

            const now = Date.now();
            const todo: TodoTask = {
                id: generateId(),
                title: task.name,
                description: `PERT task from project "${projectName}" — Duration: ${Math.round(expectedDuration)} days`,
                completed: false,
                scheduledDate: taskStart.toISOString().split('T')[0],
                dueDate: taskEnd.toISOString().split('T')[0],
                durationDays: Math.round(expectedDuration),
                priority: 'none',
                labels: ['pert-export'],
                section: 'work',
                pertProjectId: project.id,
                pertTaskId: task.id,
                pertProjectName: projectName,
                createdAt: now,
                updatedAt: now,
            };
            await insertTodo(todo);
            createdTodos.push(todo);
        }

        res.status(201).json({ exported: createdTodos.length, todos: createdTodos });
    } catch (err) {
        console.error('Error exporting todos:', err);
        res.status(500).json({ error: 'Failed to export todos' });
    }
});

// ──────────────────────────────────────
// Start
// ──────────────────────────────────────

initDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`📁 PERT Suite API running at http://0.0.0.0:${PORT}`);
        console.log(`   Database: PostgreSQL (Neon)`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
