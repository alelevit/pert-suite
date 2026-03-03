export interface PertTask {
    id: string;
    name: string;
    optimistic: number;
    likely: number;
    pessimistic: number;
    dependencies: string[];
    category?: string;           // Optional category for grouping tasks
    startDate?: string;          // ISO date — computed from project start + earlyStart
    timeUnit?: 'days' | 'hours'; // Unit for estimates (default: days)
}

export interface PertNode extends PertTask {
    duration: number;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    slack: number;
    isCritical: boolean;
}

export function calculateExpectedTime(task: PertTask): number {
    return (task.optimistic + 4 * task.likely + task.pessimistic) / 6;
}

export function calculateCPM(tasks: PertTask[]): PertNode[] {
    const nodeMap = new Map<string, PertNode>();

    tasks.forEach(task => {
        nodeMap.set(task.id, {
            ...task,
            duration: calculateExpectedTime(task),
            earlyStart: 0,
            earlyFinish: 0,
            lateStart: 0,
            lateFinish: 0,
            slack: 0,
            isCritical: false,
        });
    });

    const successorsMap = new Map<string, string[]>();
    tasks.forEach(t => successorsMap.set(t.id, []));

    tasks.forEach(task => {
        task.dependencies.forEach((depId: string) => {
            const succs = successorsMap.get(depId);
            if (succs) succs.push(task.id);
        });
    });

    const sortedIds = topologicalSort(tasks);
    if (!sortedIds) {
        console.error("Cycle detected in graph!");
        return Array.from(nodeMap.values());
    }

    // Forward Pass
    sortedIds.forEach(id => {
        const node = nodeMap.get(id)!;
        let maxPredecessorEF = 0;

        node.dependencies.forEach((depId: string) => {
            const depNode = nodeMap.get(depId);
            if (depNode) {
                maxPredecessorEF = Math.max(maxPredecessorEF, depNode.earlyFinish);
            }
        });

        node.earlyStart = maxPredecessorEF;
        node.earlyFinish = node.earlyStart + node.duration;
    });

    // Backward Pass
    let projectDuration = 0;
    nodeMap.forEach(n => {
        projectDuration = Math.max(projectDuration, n.earlyFinish);
    });

    [...sortedIds].reverse().forEach(id => {
        const node = nodeMap.get(id)!;
        const successors = successorsMap.get(id) || [];

        if (successors.length === 0) {
            node.lateFinish = projectDuration;
        } else {
            let minSuccessorLS = Infinity;
            successors.forEach(succId => {
                const succNode = nodeMap.get(succId);
                if (succNode) {
                    minSuccessorLS = Math.min(minSuccessorLS, succNode.lateStart);
                }
            });
            node.lateFinish = minSuccessorLS;
        }

        node.lateStart = node.lateFinish - node.duration;
        node.slack = node.lateStart - node.earlyStart;
        node.isCritical = Math.abs(node.slack) < 0.01;
    });

    return Array.from(nodeMap.values());
}

function topologicalSort(tasks: PertTask[]): string[] | null {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const order: string[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    function visit(taskId: string): boolean {
        if (temp.has(taskId)) return false;
        if (visited.has(taskId)) return true;

        temp.add(taskId);
        const task = taskMap.get(taskId);
        if (task) {
            for (const depId of task.dependencies) {
                if (!visit(depId)) return false;
            }
        }
        temp.delete(taskId);
        visited.add(taskId);
        order.push(taskId);
        return true;
    }

    for (const task of tasks) {
        if (!visited.has(task.id)) {
            if (!visit(task.id)) return null;
        }
    }

    return order;
}

export function createEmptyTask(): PertTask {
    return {
        id: Math.random().toString(36).substring(2, 11),
        name: 'New Task',
        optimistic: 1,
        likely: 2,
        pessimistic: 4,
        dependencies: []
    };
}

/**
 * Given a project start date and computed PERT nodes, return a map
 * from task ID → { startDate: ISO string, endDate: ISO string }.
 */
export interface CalendarRange {
    startDate: string;   // ISO date e.g. "2026-02-12"
    endDate: string;     // ISO date
}

export function computeCalendarDates(
    pertNodes: PertNode[],
    projectStartDate: string
): Map<string, CalendarRange> {
    const result = new Map<string, CalendarRange>();
    const base = new Date(projectStartDate + 'T00:00:00');
    if (isNaN(base.getTime())) return result;

    for (const node of pertNodes) {
        const start = new Date(base);
        start.setDate(start.getDate() + Math.round(node.earlyStart));

        const end = new Date(base);
        end.setDate(end.getDate() + Math.round(node.earlyFinish));

        result.set(node.id, {
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0],
        });
    }

    return result;
}
