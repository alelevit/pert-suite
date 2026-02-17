// ========================
// PERT Types (from pert-chart app)
// ========================

export interface PertTask {
    id: string;
    name: string;
    optimistic: number;
    likely: number;
    pessimistic: number;
    dependencies: string[];
    category?: string;         // Optional category for grouping tasks
    startDate?: string;        // ISO date — computed from project start + earlyStart
    timeUnit?: 'days' | 'hours'; // Unit for estimates (default: days)
}

export interface SavedProject {
    id: string;
    name: string;
    description: string;
    tasks: PertTask[];
    startDate?: string;        // ISO date — project start date
    createdAt: number;
    updatedAt: number;
}

// ========================
// Todo Types
// ========================

export type Priority = 'p1' | 'p2' | 'p3' | 'none';

export type RecurrencePattern = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

export interface Recurrence {
    pattern: RecurrencePattern;
    interval?: number;        // every N days/weeks/months
    daysOfWeek?: number[];    // 0=Sun, 1=Mon, ... for 'custom'
}

export interface TodoTask {
    id: string;
    title: string;
    description?: string;
    completed: boolean;
    completedAt?: number;

    // Scheduling
    dueDate?: string;         // ISO date "2026-02-12"
    scheduledDate?: string;    // when it shows on "Today"

    // Duration (from PERT export)
    durationDays?: number;     // task duration in calendar days

    // Organization
    priority: Priority;
    labels: string[];
    section: string;           // "inbox", "personal", "work", etc.

    // Recurrence
    recurrence?: Recurrence;

    // PERT link (optional)
    pertProjectId?: string;
    pertTaskId?: string;
    pertProjectName?: string;

    // Sub-tasks
    parentId?: string;         // ID of parent task (if this is a sub-task)

    createdAt: number;
    updatedAt: number;
}

export interface TodoSection {
    id: string;
    name: string;
    icon?: string;
    color?: string;
    order: number;
}
