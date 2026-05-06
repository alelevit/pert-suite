import express from 'express';
import cors from 'cors';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Neon's serverless Pool tunnels Postgres over WebSockets so connections are
// short-lived and the compute can autosuspend when idle. In Node we have to
// supply a WebSocket implementation; in Edge runtimes WS is built in.
neonConfig.webSocketConstructor = ws;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// ──────────────────────────────────────
// Database
// ──────────────────────────────────────

// DATABASE_URL should point at Neon's pooled host (contains "-pooler") so
// connections terminate at Neon's pgbouncer rather than holding a session
// open against the compute. Small max + short idle timeout reinforces this.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
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
                linked BOOLEAN DEFAULT false,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        // Add linked column if missing (migration for existing DBs)
        await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS linked BOOLEAN DEFAULT false`);
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
        // Indexes for common query patterns
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_scheduled_date ON todos(scheduled_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_section ON todos(section)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_completed_at ON todos(completed_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_pert_project ON todos(pert_project_id)`);

        // Migration: deduplicate PERT-linked todos
        // For each (pert_project_id, pert_task_id) group with multiple rows,
        // keep only the most recently updated row and delete the rest.
        const dupeResult = await client.query(`
            DELETE FROM todos
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                        ROW_NUMBER() OVER (
                            PARTITION BY pert_project_id, pert_task_id
                            ORDER BY updated_at DESC
                        ) AS rn
                    FROM todos
                    WHERE pert_project_id IS NOT NULL AND pert_task_id IS NOT NULL
                ) ranked
                WHERE rn > 1
            )
        `);
        if (dupeResult.rowCount && dupeResult.rowCount > 0) {
            console.log(`🧹 Cleaned up ${dupeResult.rowCount} duplicate PERT-linked todos`);
        }

        console.log('✅ Database tables and indexes initialized');
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
    linked?: boolean;
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
        pattern: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'quarterly' | 'specific-day' | 'custom';
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
        linked: row.linked || false,
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
        case 'quarterly':
            today.setMonth(today.getMonth() + 3 * interval);
            break;
        case 'specific-day': {
            // Find next occurrence of the target weekday
            const targetDay = rec.daysOfWeek?.[0] ?? 1; // default Monday
            let d = new Date(today);
            d.setDate(d.getDate() + 1);
            while (d.getDay() !== targetDay) {
                d.setDate(d.getDate() + 1);
            }
            return d.toISOString().split('T')[0];
        }
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
        // Start of today in ms for completed_at comparison
        const todayStart = new Date(today + 'T00:00:00').getTime();
        const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 5;
        const todayDayNum = new Date().getDay(); // 0=Sun, 1=Mon, ...

        // SQL-based filtering: non-completed with relevant dates/recurrence,
        // plus tasks completed today
        const result = await pool.query(
            `SELECT * FROM todos WHERE
                (
                    completed = false AND (
                        scheduled_date <= $1
                        OR due_date <= $1
                        OR (recurrence IS NOT NULL AND recurrence->>'pattern' = 'daily'
                            AND (scheduled_date IS NULL OR scheduled_date <= $1))
                        ${isWeekday ? `OR (recurrence IS NOT NULL AND recurrence->>'pattern' = 'weekdays'
                            AND (scheduled_date IS NULL OR scheduled_date <= $1))` : ''}
                        OR (
                            recurrence IS NOT NULL
                            AND recurrence->>'pattern' = 'specific-day'
                            AND recurrence->'daysOfWeek' @> $3::jsonb
                            AND (scheduled_date IS NULL OR scheduled_date <= $1)
                        )
                    )
                )
                OR (
                    completed = true AND completed_at >= $2
                )
            ${TODO_SORT}`,
            [today, todayStart, JSON.stringify([todayDayNum])]
        );

        res.json(result.rows.map(rowToTodo));
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

            // ── Sync-back to PERT project ──
            // If this todo is linked to a PERT project and duration/dueDate changed,
            // update the PERT project's task estimates accordingly.
            if (updated.pertProjectId && updated.pertTaskId) {
                const durationChanged = req.body.durationDays !== undefined && req.body.durationDays !== existing.durationDays;
                const dueDateChanged = req.body.dueDate !== undefined && req.body.dueDate !== existing.dueDate;
                const scheduledDateChanged = req.body.scheduledDate !== undefined && req.body.scheduledDate !== existing.scheduledDate;
                const titleChanged = req.body.title !== undefined && req.body.title !== existing.title;

                if (durationChanged || dueDateChanged || scheduledDateChanged || titleChanged) {
                    try {
                        const projResult = await pool.query('SELECT * FROM projects WHERE id = $1', [updated.pertProjectId]);
                        if (projResult.rows.length > 0) {
                            const project = rowToProject(projResult.rows[0]);
                            const tasks = project.tasks as any[];
                            const taskIdx = tasks.findIndex((t: any) => t.id === updated.pertTaskId);

                            if (taskIdx >= 0) {
                                const pertTask = tasks[taskIdx];

                                // Sync title
                                if (titleChanged) {
                                    pertTask.name = updated.title;
                                }

                                // Sync start date — pin the PERT task to the todo's scheduled date
                                if (scheduledDateChanged && updated.scheduledDate) {
                                    pertTask.startDate = updated.scheduledDate;
                                }

                                // Sync duration: if durationDays changed directly, use it
                                // If dueDate or scheduledDate changed, compute new duration from the delta
                                let newLikely = pertTask.likely;
                                if (durationChanged && updated.durationDays) {
                                    newLikely = updated.durationDays;
                                } else if ((dueDateChanged || scheduledDateChanged) && updated.dueDate && updated.scheduledDate) {
                                    const start = new Date(updated.scheduledDate + 'T00:00:00');
                                    const end = new Date(updated.dueDate + 'T00:00:00');
                                    const diffDays = Math.round((end.getTime() - start.getTime()) / (86400000));
                                    if (diffDays >= 1) {
                                        newLikely = diffDays;
                                    }
                                }

                                if (newLikely !== pertTask.likely) {
                                    // Recalculate optimistic/pessimistic from the likely estimate
                                    // Use ±25% as default uncertainty range
                                    const range = 0.25;
                                    pertTask.likely = newLikely;
                                    pertTask.optimistic = Math.max(1, Math.round(newLikely * (1 - range)));
                                    pertTask.pessimistic = Math.round(newLikely * (1 + range));
                                }

                                // Also update durationDays on the todo to stay in sync
                                if (newLikely !== existing.durationDays) {
                                    updated.durationDays = newLikely;
                                    await updateTodo(updated);
                                }

                                tasks[taskIdx] = pertTask;
                                await pool.query(
                                    'UPDATE projects SET tasks = $1, updated_at = $2 WHERE id = $3',
                                    [JSON.stringify(tasks), Date.now(), updated.pertProjectId]
                                );
                                console.log(`🔄 Synced todo → PERT: task "${pertTask.name}" (start: ${pertTask.startDate}, likely: ${pertTask.likely}d) in project ${updated.pertProjectId}`);
                            }
                        }
                    } catch (syncErr) {
                        // Don't fail the todo update if sync fails
                        console.error('PERT sync-back failed (non-fatal):', syncErr);
                    }
                }
            }

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
// PERT Project ↔ Todos Linking
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

// POST /api/projects/:id/link-todos — create or update linked todos (upsert)
app.post('/api/projects/:id/link-todos', async (req, res) => {
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

        let created = 0;
        let updated = 0;
        const linkedTodos: TodoTask[] = [];

        for (const task of pertTasks) {
            const expectedDuration = (task.optimistic + 4 * task.likely + task.pessimistic) / 6;
            const earlyStart = task.earlyStart ?? 0;
            const earlyFinish = task.earlyFinish ?? (earlyStart + expectedDuration);

            const taskStart = new Date(baseDate);
            taskStart.setDate(taskStart.getDate() + Math.round(earlyStart));

            const taskEnd = new Date(baseDate);
            taskEnd.setDate(taskEnd.getDate() + Math.round(earlyFinish));

            const now = Date.now();

            // Check if a linked todo already exists for this PERT task
            // Delete any duplicates first, keeping only the most recent
            const existingResult = await pool.query(
                'SELECT * FROM todos WHERE pert_project_id = $1 AND pert_task_id = $2 ORDER BY updated_at DESC',
                [project.id, task.id]
            );

            if (existingResult.rows.length > 1) {
                // Delete all but the most recent
                const keepId = existingResult.rows[0].id;
                const extraIds = existingResult.rows.slice(1).map((r: any) => r.id);
                await pool.query(
                    `DELETE FROM todos WHERE id = ANY($1::text[])`,
                    [extraIds]
                );
                console.log(`🧹 link-todos: cleaned ${extraIds.length} duplicate(s) for task "${task.name}"`);
            }

            if (existingResult.rows.length > 0) {
                // Update existing linked todo
                const existing = rowToTodo(existingResult.rows[0]);
                const updatedTodo: TodoTask = {
                    ...existing,
                    title: task.name,
                    description: `PERT task from project "${projectName}" — Duration: ${Math.round(expectedDuration)} days`,
                    scheduledDate: taskStart.toISOString().split('T')[0],
                    dueDate: taskEnd.toISOString().split('T')[0],
                    durationDays: Math.round(expectedDuration),
                    pertProjectName: projectName,
                    updatedAt: now,
                };
                await updateTodo(updatedTodo);
                linkedTodos.push(updatedTodo);
                updated++;
            } else {
                // Create new linked todo
                const todo: TodoTask = {
                    id: generateId(),
                    title: task.name,
                    description: `PERT task from project "${projectName}" — Duration: ${Math.round(expectedDuration)} days`,
                    completed: false,
                    scheduledDate: taskStart.toISOString().split('T')[0],
                    dueDate: taskEnd.toISOString().split('T')[0],
                    durationDays: Math.round(expectedDuration),
                    priority: 'none',
                    labels: ['pert-linked'],
                    section: 'work',
                    pertProjectId: project.id,
                    pertTaskId: task.id,
                    pertProjectName: projectName,
                    createdAt: now,
                    updatedAt: now,
                };
                await insertTodo(todo);
                linkedTodos.push(todo);
                created++;
            }
        }

        // Mark the project as linked
        await pool.query(
            'UPDATE projects SET linked = true, updated_at = $1 WHERE id = $2',
            [Date.now(), project.id]
        );

        res.status(201).json({ created, updated, total: linkedTodos.length, todos: linkedTodos });
    } catch (err) {
        console.error('Error linking todos:', err);
        res.status(500).json({ error: 'Failed to link todos' });
    }
});

// GET /api/projects/:id/linked-todos — get all todos linked to a project
app.get('/api/projects/:id/linked-todos', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM todos WHERE pert_project_id = $1 ORDER BY scheduled_date ASC',
            [req.params.id]
        );
        res.json(result.rows.map(rowToTodo));
    } catch (err) {
        console.error('Error fetching linked todos:', err);
        res.status(500).json({ error: 'Failed to fetch linked todos' });
    }
});

// POST /api/projects/:id/impact — analyze impact of changing a task's dates
// Body: { pertTaskId, newScheduledDate?, newDueDate? }
// Returns: { warnings: string[], affectedTasks: string[], criticalPath: boolean, projectEndDelta: number }
app.post('/api/projects/:id/impact', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        const project = rowToProject(result.rows[0]);
        const tasks = project.tasks as any[];
        const { pertTaskId, newScheduledDate, newDueDate, currentScheduledDate, currentDueDate } = req.body;
        const projectStartDate = project.startDate;

        if (!pertTaskId) {
            res.status(400).json({ error: 'pertTaskId is required' });
            return;
        }

        const targetTask = tasks.find((t: any) => t.id === pertTaskId);
        if (!targetTask) {
            res.status(404).json({ error: 'Task not found in project' });
            return;
        }

        // Helper: inline CPM calculation
        function runCPM(taskList: any[], startDateOverrides?: Map<string, string>) {
            const nodeMap = new Map<string, any>();
            for (const t of taskList) {
                const dur = (t.optimistic + 4 * t.likely + t.pessimistic) / 6;
                nodeMap.set(t.id, { ...t, duration: dur, earlyStart: 0, earlyFinish: 0, lateStart: 0, lateFinish: 0, slack: 0, isCritical: false });
            }
            const successorsMap = new Map<string, string[]>();
            for (const t of taskList) successorsMap.set(t.id, []);
            for (const t of taskList) {
                for (const depId of (t.dependencies || [])) {
                    const succs = successorsMap.get(depId);
                    if (succs) succs.push(t.id);
                }
            }
            // Simple topological sort
            const visited = new Set<string>();
            const temp = new Set<string>();
            const order: string[] = [];
            const taskMap = new Map(taskList.map((t: any) => [t.id, t]));
            function visit(taskId: string): boolean {
                if (temp.has(taskId)) return false;
                if (visited.has(taskId)) return true;
                temp.add(taskId);
                const task = taskMap.get(taskId);
                if (task) { for (const depId of (task.dependencies || [])) { if (!visit(depId)) return false; } }
                temp.delete(taskId);
                visited.add(taskId);
                order.push(taskId);
                return true;
            }
            for (const t of taskList) { if (!visited.has(t.id)) { if (!visit(t.id)) return null; } }

            const baseDate = projectStartDate ? new Date(projectStartDate + 'T00:00:00') : null;

            // Forward pass
            for (const id of order) {
                const node = nodeMap.get(id)!;
                let maxPredEF = 0;
                for (const depId of (node.dependencies || [])) {
                    const dep = nodeMap.get(depId);
                    if (dep) maxPredEF = Math.max(maxPredEF, dep.earlyFinish);
                }
                // Check for fixed start date
                const overrideStart = startDateOverrides?.get(id) || node.startDate;
                let fixedOffset = -1;
                if (overrideStart && baseDate && !isNaN(baseDate.getTime())) {
                    const ts = new Date(overrideStart + 'T00:00:00');
                    if (!isNaN(ts.getTime())) fixedOffset = Math.round((ts.getTime() - baseDate.getTime()) / 86400000);
                }
                node.earlyStart = fixedOffset >= 0 ? Math.max(fixedOffset, maxPredEF) : maxPredEF;
                node.earlyFinish = node.earlyStart + node.duration;
            }

            let projectEnd = 0;
            nodeMap.forEach(n => { projectEnd = Math.max(projectEnd, n.earlyFinish); });

            // Backward pass
            for (const id of [...order].reverse()) {
                const node = nodeMap.get(id)!;
                const successors = successorsMap.get(id) || [];
                if (successors.length === 0) {
                    node.lateFinish = projectEnd;
                } else {
                    let minSuccLS = Infinity;
                    for (const sId of successors) {
                        const s = nodeMap.get(sId);
                        if (s) minSuccLS = Math.min(minSuccLS, s.lateStart);
                    }
                    node.lateFinish = minSuccLS;
                }
                node.lateStart = node.lateFinish - node.duration;
                node.slack = node.lateStart - node.earlyStart;
                node.isCritical = Math.abs(node.slack) < 0.01;
            }

            return { nodeMap, projectEnd, order };
        }

        // Build "baseline" task list using ORIGINAL dates (before sync-back may have updated them)
        // This ensures correct comparison even if apiUpdateTodo has already sync-backed
        const baselineTasks = tasks.map((t: any) => {
            if (t.id === pertTaskId && (currentScheduledDate !== undefined || currentDueDate !== undefined)) {
                const baseline = { ...t };
                const origSched = currentScheduledDate || t.startDate;
                const origDue = currentDueDate;
                if (origSched) baseline.startDate = origSched;
                if (origDue && origSched) {
                    const start = new Date(origSched + 'T00:00:00');
                    const end = new Date(origDue + 'T00:00:00');
                    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
                    baseline.likely = days;
                    baseline.optimistic = Math.max(1, Math.round(days * 0.75));
                    baseline.pessimistic = Math.round(days * 1.25);
                }
                return baseline;
            }
            return t;
        });

        // Run CPM with baseline state (original dates)
        const current = runCPM(baselineTasks);
        if (!current) {
            res.json({ warnings: ['⚠️ Cycle detected in dependency graph'], affectedTasks: [], criticalPath: false, projectEndDelta: 0 });
            return;
        }

        // Look up the existing linked todo to get current dates as fallbacks
        const linkedTodoResult = await pool.query(
            'SELECT * FROM todos WHERE pert_project_id = $1 AND pert_task_id = $2 LIMIT 1',
            [req.params.id, pertTaskId]
        );
        const existingTodo = linkedTodoResult.rows.length > 0 ? rowToTodo(linkedTodoResult.rows[0]) : null;

        // Use provided dates, falling back to existing todo dates, then to PERT task startDate
        const effectiveScheduledDate = newScheduledDate || existingTodo?.scheduledDate || targetTask.startDate;
        const effectiveDueDate = newDueDate || existingTodo?.dueDate;

        // Build modified task list with proposed changes
        const modifiedTasks = tasks.map((t: any) => {
            if (t.id === pertTaskId) {
                const modified = { ...t };
                if (effectiveScheduledDate) modified.startDate = effectiveScheduledDate;
                if (effectiveDueDate && effectiveScheduledDate) {
                    const start = new Date(effectiveScheduledDate + 'T00:00:00');
                    const end = new Date(effectiveDueDate + 'T00:00:00');
                    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
                    modified.likely = days;
                    modified.optimistic = Math.max(1, Math.round(days * 0.75));
                    modified.pessimistic = Math.round(days * 1.25);
                }
                return modified;
            }
            return t;
        });

        const proposed = runCPM(modifiedTasks);
        if (!proposed) {
            res.json({ warnings: ['⚠️ Cycle detected in dependency graph'], affectedTasks: [], criticalPath: false, projectEndDelta: 0 });
            return;
        }

        const warnings: string[] = [];
        const affectedTasks: string[] = [];
        const currentNode = current.nodeMap.get(pertTaskId)!;
        const proposedNode = proposed.nodeMap.get(pertTaskId)!;

        // Check 1: Would the new start date violate predecessor constraints?
        if (effectiveScheduledDate && projectStartDate) {
            const baseDate = new Date(projectStartDate + 'T00:00:00');
            const proposedStart = new Date(effectiveScheduledDate + 'T00:00:00');
            const proposedOffset = Math.round((proposedStart.getTime() - baseDate.getTime()) / 86400000);

            // Find the latest predecessor finish
            let latestPredFinish = 0;
            for (const depId of (targetTask.dependencies || [])) {
                const depNode = current.nodeMap.get(depId);
                if (depNode) latestPredFinish = Math.max(latestPredFinish, depNode.earlyFinish);
            }

            if (proposedOffset < latestPredFinish) {
                // Find predecessor names
                const predNames = (targetTask.dependencies || [])
                    .map((depId: string) => tasks.find((t: any) => t.id === depId)?.name)
                    .filter(Boolean);
                const latestPredDate = new Date(baseDate);
                latestPredDate.setDate(latestPredDate.getDate() + Math.round(latestPredFinish));
                warnings.push(`⛔ Cannot start before ${latestPredDate.toISOString().split('T')[0]} — depends on: ${predNames.join(', ')}`);
            }
        }

        // Check 2: Which downstream tasks would shift?
        for (const [taskId, proposedTaskNode] of proposed.nodeMap) {
            if (taskId === pertTaskId) continue;
            const currentTaskNode = current.nodeMap.get(taskId);
            if (currentTaskNode && Math.abs(proposedTaskNode.earlyStart - currentTaskNode.earlyStart) > 0.01) {
                const deltaStr = proposedTaskNode.earlyStart > currentTaskNode.earlyStart
                    ? `+${Math.round(proposedTaskNode.earlyStart - currentTaskNode.earlyStart)}d later`
                    : `${Math.round(proposedTaskNode.earlyStart - currentTaskNode.earlyStart)}d earlier`;
                affectedTasks.push(`${proposedTaskNode.name} (${deltaStr})`);
            }
        }

        if (affectedTasks.length > 0) {
            warnings.push(`📋 Will shift ${affectedTasks.length} dependent task${affectedTasks.length > 1 ? 's' : ''}`);
        }

        // Check 3: Critical path impact
        const isCritical = currentNode.isCritical;
        if (isCritical) {
            warnings.push(`🔴 This task is on the critical path`);
        }

        // Check 4: Project end date impact
        const projectEndDelta = Math.round(proposed.projectEnd - current.projectEnd);
        if (projectEndDelta > 0) {
            warnings.push(`⏰ Project finish pushed ${projectEndDelta} day${projectEndDelta > 1 ? 's' : ''} later`);
        } else if (projectEndDelta < 0) {
            warnings.push(`✅ Project finish moves ${Math.abs(projectEndDelta)} day${Math.abs(projectEndDelta) > 1 ? 's' : ''} earlier`);
        }

        res.json({ warnings, affectedTasks, criticalPath: isCritical, projectEndDelta });
    } catch (err) {
        console.error('Error computing impact:', err);
        res.status(500).json({ error: 'Failed to compute impact' });
    }
});

// DELETE /api/projects/:id/linked-todos — unlink all todos from a project
app.delete('/api/projects/:id/linked-todos', async (req, res) => {
    try {
        // Remove PERT link fields but keep the todos
        await pool.query(
            `UPDATE todos SET pert_project_id = NULL, pert_task_id = NULL, pert_project_name = NULL, updated_at = $1 WHERE pert_project_id = $2`,
            [Date.now(), req.params.id]
        );
        await pool.query(
            'UPDATE projects SET linked = false, updated_at = $1 WHERE id = $2',
            [Date.now(), req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error unlinking todos:', err);
        res.status(500).json({ error: 'Failed to unlink todos' });
    }
});

// ──────────────────────────────────────
// Static frontend serving
// ──────────────────────────────────────

// __dirname is server/dist when compiled, so go up two levels to repo root
const repoRoot = path.resolve(__dirname, '..', '..');
const todoDistDir = path.join(repoRoot, 'apps', 'todo', 'dist');
const pertDistDir = path.join(repoRoot, 'apps', 'pert-chart', 'dist');

// Serve todo app at /todo
app.use('/todo', express.static(todoDistDir));
app.get('/todo/{*path}', (_req, res) => {
    res.sendFile(path.join(todoDistDir, 'index.html'));
});

// Serve pert chart app at /pert
app.use('/pert', express.static(pertDistDir));
app.get('/pert/{*path}', (_req, res) => {
    res.sendFile(path.join(pertDistDir, 'index.html'));
});

// Root redirects to todo app
app.get('/', (_req, res) => {
    res.redirect('/todo');
});

// ──────────────────────────────────────
// Start
// ──────────────────────────────────────

initDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`📁 PERT Suite running at http://0.0.0.0:${PORT}`);
        console.log(`   Todo app:  /todo`);
        console.log(`   PERT app:  /pert`);
        console.log(`   API:       /api`);
        console.log(`   Database:  PostgreSQL (Neon)`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
