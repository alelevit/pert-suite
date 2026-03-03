import type { TodoTask } from '@pert-suite/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ========================
// localStorage Cache Layer
// ========================

const CACHE_KEYS = {
    today: 'todo_cache_today',
    inbox: 'todo_cache_inbox',
    upcoming: 'todo_cache_upcoming',
    all: 'todo_cache_all',
    allTodos: 'todo_cache_all_todos',
    sections: 'todo_cache_sections',
} as const;

function saveToCache(key: string, data: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch {
        // localStorage full or unavailable — ignore
    }
}

function readFromCache<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
}

/** Get cached todos for the current view (instant render on app launch) */
export function getCachedTodos(view: 'today' | 'inbox' | 'upcoming' | 'all'): TodoTask[] | null {
    return readFromCache<TodoTask[]>(CACHE_KEYS[view]);
}

/** Get cached "all todos" list (for subtask parent mapping) */
export function getCachedAllTodos(): TodoTask[] | null {
    return readFromCache<TodoTask[]>(CACHE_KEYS.allTodos);
}

/** Get cached sections */
export function getCachedSections(): string[] | null {
    return readFromCache<string[]>(CACHE_KEYS.sections);
}

// ========================
// Todo CRUD
// ========================

export async function apiGetTodos(params?: {
    date?: string;
    section?: string;
    completed?: boolean;
}): Promise<TodoTask[]> {
    const url = new URL(`${API_BASE}/todos`, API_BASE.startsWith('http') ? undefined : window.location.origin);
    if (params?.date) url.searchParams.set('date', params.date);
    if (params?.section) url.searchParams.set('section', params.section);
    if (params?.completed !== undefined) url.searchParams.set('completed', String(params.completed));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed to fetch todos');
    const data: TodoTask[] = await res.json();
    // Cache based on params
    if (!params || Object.keys(params).length === 0) {
        saveToCache(CACHE_KEYS.allTodos, data);
    } else if (params.section === 'inbox' && params.completed === false) {
        saveToCache(CACHE_KEYS.inbox, data);
    }
    return data;
}

export async function apiGetTodayTodos(): Promise<TodoTask[]> {
    const res = await fetch(`${API_BASE}/todos/today`);
    if (!res.ok) throw new Error('Failed to fetch today todos');
    const data: TodoTask[] = await res.json();
    saveToCache(CACHE_KEYS.today, data);
    return data;
}

export async function apiCreateTodo(todo: Partial<TodoTask>): Promise<TodoTask> {
    const res = await fetch(`${API_BASE}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(todo),
    });
    if (!res.ok) throw new Error('Failed to create todo');
    return res.json();
}

export async function apiUpdateTodo(id: string, updates: Partial<TodoTask>): Promise<TodoTask> {
    const res = await fetch(`${API_BASE}/todos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update todo');
    return res.json();
}

export async function apiDeleteTodo(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete todo');
}

export async function apiCompleteTodo(id: string): Promise<{ completed: TodoTask; next?: TodoTask }> {
    const res = await fetch(`${API_BASE}/todos/${id}/complete`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to complete todo');
    return res.json();
}

export async function apiGetUpcomingTodos(): Promise<TodoTask[]> {
    const res = await fetch(`${API_BASE}/todos/upcoming`);
    if (!res.ok) throw new Error('Failed to fetch upcoming todos');
    const data: TodoTask[] = await res.json();
    saveToCache(CACHE_KEYS.upcoming, data);
    return data;
}

export async function apiGetSections(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/todos/sections`);
    if (!res.ok) throw new Error('Failed to fetch sections');
    const data: string[] = await res.json();
    saveToCache(CACHE_KEYS.sections, data);
    return data;
}

/**
 * Send today's tasks to the LLM for day planning advice.
 * Returns the AI's suggestions as a string.
 */
export async function apiAnalyzeTodos(
    tasks: TodoTask[],
    apiKey: string,
    model: string = 'gpt-4o'
): Promise<string> {
    const taskSummary = tasks.map((t, i) =>
        `${i + 1}. "${t.title}" — Priority: ${t.priority}, Section: ${t.section}${t.dueDate ? `, Due: ${t.dueDate}` : ''}${(t as any).durationDays ? `, Duration: ${(t as any).durationDays}d` : ''}`
    ).join('\n');

    const systemPrompt = `You are a productivity coach helping optimize a user's day. 
Given their task list, provide brief, actionable suggestions:
- Reorder tasks by priority and energy levels (hardest first, or group similar tasks)
- Flag if the day looks overloaded
- Suggest batching related tasks
- Note any tasks that might conflict or be better moved to another day
Keep your response concise (3-5 bullet points). Be friendly and practical.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Here are my tasks for today:\n${taskSummary}\n\nWhat do you suggest?` }
            ],
            temperature: 0.7,
            max_tokens: 500
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Failed to analyze tasks');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * Mock advisor for when no API key is configured.
 */
export async function mockAnalyzeTodos(tasks: TodoTask[]): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 800));

    const p1Count = tasks.filter(t => t.priority === 'p1').length;
    const p2Count = tasks.filter(t => t.priority === 'p2').length;
    const total = tasks.length;

    const tips: string[] = [];

    if (total === 0) {
        return "Your day looks clear! Consider picking up tasks from your Inbox or upcoming list.";
    }

    if (p1Count > 3) {
        tips.push(`⚠️ You have ${p1Count} P1 tasks — that's a lot of high-priority items. Consider if some can be delegated or moved to tomorrow.`);
    }

    if (total > 8) {
        tips.push(`📋 ${total} tasks is an ambitious day. Focus on completing the top 3-5 and move the rest.`);
    } else {
        tips.push(`✅ ${total} tasks is a manageable workload. Nice!`);
    }

    if (p1Count > 0) {
        tips.push(`🎯 Tackle your ${p1Count} P1 task${p1Count > 1 ? 's' : ''} first while your energy is highest.`);
    }

    if (p2Count > 0 && p1Count > 0) {
        tips.push(`📌 After P1s, move on to your ${p2Count} P2 task${p2Count > 1 ? 's' : ''}.`);
    }

    const pertTasks = tasks.filter(t => t.pertProjectId);
    if (pertTasks.length > 0) {
        tips.push(`📊 You have ${pertTasks.length} project task${pertTasks.length > 1 ? 's' : ''} from PERT — these have deadlines, prioritize them.`);
    }

    tips.push("💡 Try batching similar tasks (emails, calls) together for efficiency.");

    return tips.join('\n\n');
}

// ========================
// PERT Impact Analysis
// ========================

export interface PertImpactResult {
    warnings: string[];
    affectedTasks: string[];
    criticalPath: boolean;
    projectEndDelta: number;
}

/**
 * Analyze the impact of changing dates on a PERT-linked task.
 */
export async function apiGetPertImpact(
    projectId: string,
    pertTaskId: string,
    newScheduledDate?: string,
    newDueDate?: string,
    currentScheduledDate?: string,
    currentDueDate?: string
): Promise<PertImpactResult> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pertTaskId, newScheduledDate, newDueDate, currentScheduledDate, currentDueDate }),
    });
    if (!res.ok) throw new Error('Failed to get impact analysis');
    return res.json();
}
