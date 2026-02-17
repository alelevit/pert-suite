import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Data directory — use DATA_ROOT env var (Railway volume) or default to local
const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');
const DATA_DIR = path.join(DATA_ROOT, 'projects');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check for Railway
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
    startDate?: string;    // ISO date — project start date
    createdAt: number;
    updatedAt: number;
}

// ──────────────────────────────────────
// Helpers
// ──────────────────────────────────────

function projectFilePath(id: string): string {
    // Sanitize ID to prevent directory traversal
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(DATA_DIR, `${safeId}.json`);
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function readProject(id: string): SavedProject | null {
    const filePath = projectFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data) as SavedProject;
    } catch {
        return null;
    }
}

function writeProject(project: SavedProject): void {
    const filePath = projectFilePath(project.id);
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
}

function getAllProjects(): SavedProject[] {
    try {
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        const projects: SavedProject[] = [];
        for (const file of files) {
            try {
                const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
                projects.push(JSON.parse(data) as SavedProject);
            } catch {
                // Skip invalid files
            }
        }
        // Sort by updatedAt descending (most recent first)
        return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
        return [];
    }
}

// ──────────────────────────────────────
// Routes
// ──────────────────────────────────────

// GET /api/projects — list all projects
app.get('/api/projects', (_req, res) => {
    const projects = getAllProjects();
    res.json(projects);
});

// GET /api/projects/:id — get single project
app.get('/api/projects/:id', (req, res) => {
    const project = readProject(req.params.id);
    if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }
    res.json(project);
});

// POST /api/projects — create new project
app.post('/api/projects', (req, res) => {
    const { name, description, tasks } = req.body;
    const now = Date.now();
    const project: SavedProject = {
        id: generateId(),
        name: name || 'Untitled Project',
        description: description || '',
        tasks: tasks || [],
        createdAt: now,
        updatedAt: now
    };
    writeProject(project);
    res.status(201).json(project);
});

// PUT /api/projects/:id — upsert (update or create) project
app.put('/api/projects/:id', (req, res) => {
    const existing = readProject(req.params.id);
    if (existing) {
        const updated: SavedProject = {
            ...existing,
            ...req.body,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: Date.now()
        };
        writeProject(updated);
        res.json(updated);
    } else {
        const project: SavedProject = {
            ...req.body,
            id: req.params.id,
            createdAt: req.body.createdAt || Date.now(),
            updatedAt: req.body.updatedAt || Date.now(),
        };
        writeProject(project);
        res.status(201).json(project);
    }
});

// DELETE /api/projects/:id — delete project
app.delete('/api/projects/:id', (req, res) => {
    const filePath = projectFilePath(req.params.id);
    if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }
    fs.unlinkSync(filePath);
    res.json({ success: true });
});

// POST /api/projects/import — import a single project
app.post('/api/projects/import', (req, res) => {
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
            updatedAt: now
        };
        writeProject(project);
        res.status(201).json(project);
    } catch {
        res.status(400).json({ error: 'Failed to import project' });
    }
});

// POST /api/projects/migrate — bulk import from localStorage
app.post('/api/projects/migrate', (req, res) => {
    try {
        const { projects } = req.body as { projects: SavedProject[] };
        if (!Array.isArray(projects)) {
            res.status(400).json({ error: 'Expected { projects: [...] }' });
            return;
        }
        const migrated: SavedProject[] = [];
        for (const p of projects) {
            // Use existing IDs if they have them, otherwise generate new ones
            const project: SavedProject = {
                id: p.id || generateId(),
                name: p.name || 'Untitled',
                description: p.description || '',
                tasks: p.tasks || [],
                createdAt: p.createdAt || Date.now(),
                updatedAt: p.updatedAt || Date.now()
            };
            writeProject(project);
            migrated.push(project);
        }
        res.status(201).json({ migrated: migrated.length, projects: migrated });
    } catch {
        res.status(400).json({ error: 'Migration failed' });
    }
});

// ──────────────────────────────────────
// Todo Data
// ──────────────────────────────────────

const TODO_DIR = path.join(DATA_ROOT, 'todos');

if (!fs.existsSync(TODO_DIR)) {
    fs.mkdirSync(TODO_DIR, { recursive: true });
}

interface TodoTask {
    id: string;
    title: string;
    description?: string;
    completed: boolean;
    completedAt?: number;
    dueDate?: string;
    scheduledDate?: string;
    durationDays?: number;     // task duration in calendar days (from PERT)
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

function todoFilePath(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(TODO_DIR, `${safeId}.json`);
}

function readTodo(id: string): TodoTask | null {
    const filePath = todoFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data) as TodoTask;
    } catch {
        return null;
    }
}

function writeTodo(todo: TodoTask): void {
    const filePath = todoFilePath(todo.id);
    fs.writeFileSync(filePath, JSON.stringify(todo, null, 2), 'utf-8');
}

function getAllTodos(): TodoTask[] {
    try {
        const files = fs.readdirSync(TODO_DIR).filter(f => f.endsWith('.json'));
        const todos: TodoTask[] = [];
        for (const file of files) {
            try {
                const data = fs.readFileSync(path.join(TODO_DIR, file), 'utf-8');
                todos.push(JSON.parse(data) as TodoTask);
            } catch { /* skip */ }
        }
        return todos.sort((a, b) => {
            // Sort by priority then creation
            const pOrder = { p1: 0, p2: 1, p3: 2, none: 3 };
            if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
            return a.createdAt - b.createdAt;
        });
    } catch {
        return [];
    }
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

// GET /api/todos — list todos (with optional filters)
app.get('/api/todos', (req, res) => {
    let todos = getAllTodos();
    const { date, section, completed } = req.query;

    if (date) {
        todos = todos.filter(t => t.scheduledDate === date || t.dueDate === date);
    }
    if (section) {
        todos = todos.filter(t => t.section === section);
    }
    if (completed !== undefined) {
        const wantCompleted = completed === 'true';
        todos = todos.filter(t => t.completed === wantCompleted);
    }
    res.json(todos);
});

// GET /api/todos/sections — list unique section names
app.get('/api/todos/sections', (_req, res) => {
    const allTodos = getAllTodos();
    const sections = [...new Set(allTodos.filter(t => !t.completed).map(t => t.section))].sort();
    res.json(sections);
});

// GET /api/todos/today — get today's tasks
app.get('/api/todos/today', (_req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const allTodos = getAllTodos();

    const todayTodos = allTodos.filter(t => {
        // Already completed today — show in completed section
        if (t.completed && t.completedAt) {
            const completedDate = new Date(t.completedAt).toISOString().split('T')[0];
            return completedDate === today;
        }
        // Not completed:
        if (t.completed) return false;

        // Scheduled for today or earlier (overdue)
        if (t.scheduledDate && t.scheduledDate <= today) return true;
        // Due today or earlier
        if (t.dueDate && t.dueDate <= today) return true;
        // Recurring daily tasks (always show)
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
});

// GET /api/todos/upcoming — todos scheduled for the future
app.get('/api/todos/upcoming', (_req, res) => {
    const allTodos = getAllTodos();
    const today = new Date().toISOString().split('T')[0];

    const upcoming = allTodos
        .filter((t: TodoTask) => {
            if (t.completed) return false;
            const futureScheduled = t.scheduledDate && t.scheduledDate > today;
            const futureDue = t.dueDate && t.dueDate > today;
            return futureScheduled || futureDue;
        })
        .sort((a: TodoTask, b: TodoTask) => {
            const dateA = a.scheduledDate || a.dueDate || '';
            const dateB = b.scheduledDate || b.dueDate || '';
            return dateA.localeCompare(dateB);
        });

    res.json(upcoming);
});

// POST /api/todos — create new todo
app.post('/api/todos', (req, res) => {
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
    writeTodo(todo);
    res.status(201).json(todo);
});

// PUT /api/todos/:id — upsert (update or create) todo
app.put('/api/todos/:id', (req, res) => {
    const existing = readTodo(req.params.id);
    if (existing) {
        const updated: TodoTask = {
            ...existing,
            ...req.body,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: Date.now(),
        };
        writeTodo(updated);
        res.json(updated);
    } else {
        // Create new with the given ID
        const todo: TodoTask = {
            ...req.body,
            id: req.params.id,
            createdAt: req.body.createdAt || Date.now(),
            updatedAt: req.body.updatedAt || Date.now(),
        };
        writeTodo(todo);
        res.status(201).json(todo);
    }
});

// DELETE /api/todos/:id — delete todo
app.delete('/api/todos/:id', (req, res) => {
    const filePath = todoFilePath(req.params.id);
    if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Todo not found' });
        return;
    }
    fs.unlinkSync(filePath);
    res.json({ success: true });
});

// POST /api/todos/:id/complete — mark complete (handles recurrence)
app.post('/api/todos/:id/complete', (req, res) => {
    const todo = readTodo(req.params.id);
    if (!todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
    }

    // Mark this instance as completed
    todo.completed = true;
    todo.completedAt = Date.now();
    todo.updatedAt = Date.now();
    writeTodo(todo);

    let nextTodo: TodoTask | undefined;

    // If recurring, create the next instance
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
        writeTodo(nextTodo);
    }

    res.json({ completed: todo, next: nextTodo });
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

app.post('/api/projects/:id/export-todos', (req, res) => {
    const project = readProject(req.params.id);
    if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }

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
        writeTodo(todo);
        createdTodos.push(todo);
    }

    res.status(201).json({ exported: createdTodos.length, todos: createdTodos });
});

// ──────────────────────────────────────
// Start
// ──────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📁 PERT Suite API running at http://0.0.0.0:${PORT}`);
    console.log(`   Projects: ${DATA_DIR}`);
    console.log(`   Todos:    ${TODO_DIR}`);
});
