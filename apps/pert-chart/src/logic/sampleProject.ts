import type { PertTask } from './pert';

/**
 * Hypothetical example shown when the PERT chart first opens: opening a coffee
 * shop. The build-out drives the critical path (business plan → financing →
 * lease → renovation → equipment install → inspection → soft and grand
 * opening). Equipment, staffing, menu and marketing are side branches that
 * split off the critical path and rejoin it with slack to spare.
 * Estimates are in days.
 */
export const sampleProjectTasks: PertTask[] = [
    { id: '1', name: 'Write business plan', category: 'Planning', optimistic: 5, likely: 7, pessimistic: 9, dependencies: [] },
    { id: '2', name: 'Secure financing', category: 'Finance', optimistic: 10, likely: 14, pessimistic: 18, dependencies: ['1'] },
    { id: '3', name: 'Sign lease', category: 'Location', optimistic: 3, likely: 5, pessimistic: 7, dependencies: ['2'] },
    { id: '4', name: 'Renovate space', category: 'Build-out', optimistic: 20, likely: 25, pessimistic: 30, dependencies: ['3'] },
    { id: '5', name: 'Install equipment', category: 'Build-out', optimistic: 2, likely: 3, pessimistic: 4, dependencies: ['4', '10'] },
    { id: '6', name: 'Pass health inspection', category: 'Permits', optimistic: 1, likely: 2, pessimistic: 3, dependencies: ['5'] },
    { id: '7', name: 'Soft opening', category: 'Launch', optimistic: 2, likely: 3, pessimistic: 4, dependencies: ['6', '12', '14'] },
    { id: '8', name: 'Grand opening', category: 'Launch', optimistic: 1, likely: 1, pessimistic: 1, dependencies: ['7', '15'] },
    // Equipment branch: lease → choose → order → install
    { id: '9', name: 'Choose espresso equipment', category: 'Equipment', optimistic: 3, likely: 4, pessimistic: 5, dependencies: ['3'] },
    { id: '10', name: 'Order & deliver equipment', category: 'Equipment', optimistic: 8, likely: 12, pessimistic: 16, dependencies: ['9'] },
    // Staffing branch: financing → hire → train → soft opening
    { id: '11', name: 'Hire baristas', category: 'Staffing', optimistic: 7, likely: 10, pessimistic: 13, dependencies: ['2'] },
    { id: '12', name: 'Train staff', category: 'Staffing', optimistic: 5, likely: 7, pessimistic: 9, dependencies: ['11'] },
    // Menu branch: business plan → menu → suppliers → soft opening
    { id: '13', name: 'Develop menu', category: 'Menu', optimistic: 6, likely: 8, pessimistic: 10, dependencies: ['1'] },
    { id: '14', name: 'Line up suppliers', category: 'Menu', optimistic: 4, likely: 6, pessimistic: 8, dependencies: ['13'] },
    // Marketing branch: lease → campaign → grand opening
    { id: '15', name: 'Run marketing campaign', category: 'Marketing', optimistic: 7, likely: 10, pessimistic: 13, dependencies: ['3'] },
];
