/**
 * API client for file-based project storage.
 * Talks to the Express API server at /api/projects.
 */

import type { SavedProject } from './projectStorage';

const API_ROOT = import.meta.env.VITE_API_URL || '';
const API_BASE = `${API_ROOT}/api/projects`;

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
}

/**
 * Get all saved projects from the API
 */
export async function apiGetAllProjects(): Promise<SavedProject[]> {
    const response = await fetch(API_BASE);
    return handleResponse<SavedProject[]>(response);
}

/**
 * Save a new project via the API
 */
export async function apiCreateProject(project: {
    name: string;
    description: string;
    tasks: unknown[];
}): Promise<SavedProject> {
    const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
    });
    return handleResponse<SavedProject>(response);
}

/**
 * Update an existing project via the API
 */
export async function apiUpdateProject(id: string, updates: Partial<SavedProject>): Promise<SavedProject> {
    const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    return handleResponse<SavedProject>(response);
}

/**
 * Load a specific project by ID
 */
export async function apiLoadProject(id: string): Promise<SavedProject | null> {
    try {
        const response = await fetch(`${API_BASE}/${id}`);
        if (response.status === 404) return null;
        return handleResponse<SavedProject>(response);
    } catch {
        return null;
    }
}

/**
 * Delete a project by ID
 */
export async function apiDeleteProject(id: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Rename a project
 */
export async function apiRenameProject(id: string, newName: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Import a project from parsed JSON data
 */
export async function apiImportProject(data: {
    name: string;
    description?: string;
    tasks: unknown[];
}): Promise<SavedProject | null> {
    try {
        const response = await fetch(`${API_BASE}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return handleResponse<SavedProject>(response);
    } catch {
        return null;
    }
}

/**
 * Migrate projects from localStorage to the API.
 * Returns the number of projects migrated.
 */
export async function apiMigrateFromLocalStorage(): Promise<number> {
    const STORAGE_KEY = 'pert_projects';
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;

    try {
        const projects = JSON.parse(raw) as SavedProject[];
        if (!Array.isArray(projects) || projects.length === 0) return 0;

        const response = await fetch(`${API_BASE}/migrate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projects })
        });

        if (response.ok) {
            const result = await response.json();
            // Clear localStorage after successful migration
            localStorage.removeItem(STORAGE_KEY);
            console.log(`✅ Migrated ${result.migrated} projects from localStorage to file storage`);
            return result.migrated;
        }
        return 0;
    } catch (e) {
        console.error('Migration failed:', e);
        return 0;
    }
}

/**
 * Link PERT tasks as Todo items (upsert — no duplicates on re-link).
 * Sends computed PERT nodes to the server which creates/updates duration-based TodoTasks.
 */
export async function apiLinkToTodo(
    projectId: string,
    tasks: { id: string; name: string; optimistic: number; likely: number; pessimistic: number; dependencies: string[]; earlyStart?: number; earlyFinish?: number; duration?: number }[],
    startDate?: string
): Promise<{ created: number; updated: number; total: number }> {
    const response = await fetch(`${API_BASE}/${projectId}/link-todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, startDate })
    });
    return handleResponse<{ created: number; updated: number; total: number }>(response);
}

/**
 * Get all Todo tasks linked to a PERT project.
 */
export async function apiGetLinkedTodos(projectId: string): Promise<any[]> {
    const response = await fetch(`${API_BASE}/${projectId}/linked-todos`);
    return handleResponse<any[]>(response);
}

/**
 * Unlink all Todo tasks from a PERT project (keeps todos, removes PERT link).
 */
export async function apiUnlinkProject(projectId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_BASE}/${projectId}/linked-todos`, {
        method: 'DELETE',
    });
    return handleResponse<{ success: boolean }>(response);
}

// Legacy alias for backwards compatibility
export const apiExportToTodo = apiLinkToTodo;
