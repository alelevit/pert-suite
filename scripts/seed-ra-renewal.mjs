#!/usr/bin/env node
// One-shot seed: adds 5 P1 todos for the FL Registered-Agent change sequence.
// Idempotent — uses fixed IDs and PUT upsert, so re-running edits in place.
//
// Usage:  node scripts/seed-ra-renewal.mjs
// Override target:  API_BASE=http://localhost:3001/api node scripts/seed-ra-renewal.mjs

const API_BASE = process.env.API_BASE || 'https://pert-suite-server.onrender.com/api';

const tasks = [
    {
        id: 'seed-ra-renewal-1',
        title: 'Sign up with new FL registered agent (Northwest or equivalent)',
        description: 'Get RA name, FL street address, and signed acceptance. Do this first so the change form has the new RA info ready.',
    },
    {
        id: 'seed-ra-renewal-2',
        title: 'Mail RA change form + $25 check to Sunbiz',
        description: 'Allow 1–2 weeks for processing. Pay extra ~$8.75 for expedited if cutting it close to the auto-renewal date.',
    },
    {
        id: 'seed-ra-renewal-3',
        title: 'Verify new RA on Sunbiz public record',
        description: 'Search the LLC on sunbiz.org and confirm the new registered agent is showing before doing anything else (esp. before cancelling LegalZoom).',
    },
    {
        id: 'seed-ra-renewal-4',
        title: 'Cancel LegalZoom RA service (888-310-0151)',
        description: "They'll try to talk you out of it — be firm. Get a confirmation email.",
    },
    {
        id: 'seed-ra-renewal-5',
        title: 'Same LegalZoom call: cancel State Compliance Filings ($199) + Business Licenses & Permits ($99)',
        description: 'Knock all three cancellations out on the same call. Confirm each in writing.',
    },
];

const now = Date.now();

async function upsert(task, idx) {
    const body = {
        ...task,
        completed: false,
        priority: 'p1',
        section: 'inbox',
        labels: [],
        createdAt: now + idx,
        updatedAt: now + idx,
    };
    const res = await fetch(`${API_BASE}/todos/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PUT ${task.id} failed: ${res.status} ${text}`);
    }
    return res.json();
}

(async () => {
    console.log(`Seeding ${tasks.length} P1 tasks → ${API_BASE}`);
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        try {
            await upsert(t, i);
            console.log(`  ✓ ${t.id}  ${t.title}`);
        } catch (err) {
            console.error(`  ✗ ${t.id}  ${err.message}`);
            process.exitCode = 1;
        }
    }
    console.log('Done.');
})();
