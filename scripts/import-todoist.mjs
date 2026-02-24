#!/usr/bin/env node

/**
 * Import tasks from Todoist into PERT Suite Todo app.
 *
 * Usage:
 *   TODOIST_TOKEN=<token> node scripts/import-todoist.mjs
 *   — or —
 *   node scripts/import-todoist.mjs <token>
 */

const TODOIST_API = 'https://api.todoist.com/api/v1';
const TODO_API = 'http://localhost:3001/api/todos';
const TOKEN = process.argv[2] || process.env.TODOIST_TOKEN;

if (!TOKEN) {
    console.error('Usage: node scripts/import-todoist.mjs <todoist-api-token>');
    process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────

async function todoistGet(path, params = {}) {
    const url = new URL(`${TODOIST_API}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Todoist ${path}: ${res.status} ${await res.text()}`);
    return res.json();
}

async function todoistGetAll(path) {
    const results = [];
    let cursor = null;
    do {
        const params = cursor ? { cursor } : {};
        const data = await todoistGet(path, params);
        results.push(...(data.results || []));
        cursor = data.next_cursor || null;
    } while (cursor);
    return results;
}

// ─── Priority mapping ───────────────────────────────────────────
// Todoist: 4=P1(urgent), 3=P2(high), 2=P3(medium), 1=no priority
// Ours:    'p1', 'p2', 'p3', 'none'

function mapPriority(todoistPrio) {
    switch (todoistPrio) {
        case 4: return 'p1';
        case 3: return 'p2';
        case 2: return 'p3';
        default: return 'none';
    }
}

// ─── Section name cleanup ───────────────────────────────────────

function cleanSectionName(name) {
    return name
        .replace(/[^\w\s.-]/g, '')  // Remove emoji etc.
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');       // Spaces → hyphens
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
    console.log('📥 Fetching Todoist data...\n');

    // Fetch everything in parallel
    const [tasks, projects, sections] = await Promise.all([
        todoistGetAll('/tasks'),
        todoistGetAll('/projects'),
        todoistGetAll('/sections'),
    ]);

    // Build lookup maps
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const sectionMap = Object.fromEntries(sections.map(s => [s.id, s.name]));

    console.log(`  Found ${tasks.length} tasks across ${projects.length} projects\n`);

    // Filter out "Welcome 👋" onboarding project
    const skipProjects = new Set(
        projects.filter(p => p.name.includes('Welcome')).map(p => p.id)
    );

    const toImport = tasks.filter(t => {
        if (t.checked || t.is_deleted) return false;
        if (skipProjects.has(t.project_id)) return false;
        // Skip tasks that are just markdown links (Todoist onboarding)
        if (t.content.startsWith('[') && t.content.includes('todoist.com')) return false;
        return true;
    });

    console.log(`  Importing ${toImport.length} tasks (skipped ${tasks.length - toImport.length} onboarding/completed)\n`);

    // Import tasks
    let imported = 0;
    let failed = 0;
    const sectionCounts = {};

    for (const t of toImport) {
        const projectName = projectMap[t.project_id] || 'inbox';
        const section = cleanSectionName(projectName) || 'inbox';
        sectionCounts[section] = (sectionCounts[section] || 0) + 1;

        const dueDate = t.due?.date || undefined;

        const todo = {
            title: t.content,
            description: t.description || undefined,
            dueDate,
            scheduledDate: dueDate, // Show in "Today" if due today
            priority: mapPriority(t.priority),
            labels: t.labels || [],
            section,
        };

        try {
            const res = await fetch(TODO_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(todo),
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error(`  ❌ Failed: "${t.content.slice(0, 50)}" → ${res.status}: ${errText}`);
                failed++;
            } else {
                imported++;
            }
        } catch (err) {
            console.error(`  ❌ Network error for "${t.content.slice(0, 50)}": ${err.message}`);
            failed++;
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log(`✅ Imported: ${imported} tasks`);
    if (failed) console.log(`❌ Failed:   ${failed} tasks`);
    console.log('\nBy section:');
    for (const [section, count] of Object.entries(sectionCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  📁 ${section}: ${count}`);
    }
    console.log();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
