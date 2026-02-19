import type { PertTask } from '../logic/pert';

export interface SavedProject {
    id: string;
    name: string;
    description: string;
    tasks: PertTask[];
    startDate?: string;    // ISO date — project start date
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'pert_projects';

/**
 * Get all saved projects from localStorage
 */
export function getAllProjects(): SavedProject[] {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        return JSON.parse(data) as SavedProject[];
    } catch {
        console.error('Failed to load projects from localStorage');
        return [];
    }
}

/**
 * Save a project (create new or update existing)
 */
export function saveProject(project: Omit<SavedProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): SavedProject {
    const projects = getAllProjects();
    const now = Date.now();

    if (project.id) {
        // Update existing
        const index = projects.findIndex(p => p.id === project.id);
        if (index !== -1) {
            const updated: SavedProject = {
                ...projects[index],
                ...project,
                id: project.id,
                updatedAt: now
            };
            projects[index] = updated;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
            return updated;
        }
    }

    // Create new
    const newProject: SavedProject = {
        id: generateId(),
        name: project.name,
        description: project.description,
        tasks: project.tasks,
        createdAt: now,
        updatedAt: now
    };
    projects.push(newProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return newProject;
}

/**
 * Load a specific project by ID
 */
export function loadProject(id: string): SavedProject | null {
    const projects = getAllProjects();
    return projects.find(p => p.id === id) || null;
}

/**
 * Delete a project by ID
 */
export function deleteProject(id: string): boolean {
    const projects = getAllProjects();
    const filtered = projects.filter(p => p.id !== id);
    if (filtered.length === projects.length) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
}

/**
 * Rename a project
 */
export function renameProject(id: string, newName: string): boolean {
    const projects = getAllProjects();
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) return false;
    projects[index].name = newName;
    projects[index].updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return true;
}

/**
 * Export project to JSON string
 */
export function exportProject(project: SavedProject): string {
    return JSON.stringify(project, null, 2);
}

/**
 * Import project from JSON string
 */
export function importProject(jsonString: string): SavedProject | null {
    try {
        const data = JSON.parse(jsonString) as SavedProject;
        // Validate required fields
        if (!data.name || !Array.isArray(data.tasks)) {
            throw new Error('Invalid project format');
        }
        // Save with new ID to avoid conflicts
        return saveProject({
            name: data.name + ' (Imported)',
            description: data.description || '',
            tasks: data.tasks
        });
    } catch (e) {
        console.error('Failed to import project:', e);
        return null;
    }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
