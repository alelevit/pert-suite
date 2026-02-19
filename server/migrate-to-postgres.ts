import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL!;
const DATA_DIR = path.join(__dirname, '..', 'data');

const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    const client = await pool.connect();
    try {
        // Migrate projects
        const projectDir = path.join(DATA_DIR, 'projects');
        const projectFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.json'));
        console.log(`Migrating ${projectFiles.length} projects...`);

        for (const file of projectFiles) {
            const data = JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf-8'));
            await client.query(
                `INSERT INTO projects (id, name, description, tasks, start_date, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, tasks=$4, start_date=$5, updated_at=$7`,
                [data.id, data.name, data.description || '', JSON.stringify(data.tasks || []), data.startDate || null, data.createdAt, data.updatedAt]
            );
        }
        console.log(`✅ ${projectFiles.length} projects migrated`);

        // Migrate todos
        const todoDir = path.join(DATA_DIR, 'todos');
        const todoFiles = fs.readdirSync(todoDir).filter(f => f.endsWith('.json'));
        console.log(`Migrating ${todoFiles.length} todos...`);

        let count = 0;
        for (const file of todoFiles) {
            const data = JSON.parse(fs.readFileSync(path.join(todoDir, file), 'utf-8'));
            await client.query(
                `INSERT INTO todos (id, title, description, completed, completed_at, due_date, scheduled_date, duration_days, priority, labels, section, recurrence, pert_project_id, pert_task_id, pert_project_name, parent_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                 ON CONFLICT (id) DO UPDATE SET title=$2, description=$3, completed=$4, completed_at=$5, due_date=$6, scheduled_date=$7, duration_days=$8, priority=$9, labels=$10, section=$11, recurrence=$12, pert_project_id=$13, pert_task_id=$14, pert_project_name=$15, parent_id=$16, updated_at=$18`,
                [
                    data.id, data.title, data.description || null,
                    data.completed || false, data.completedAt || null,
                    data.dueDate || null, data.scheduledDate || null,
                    data.durationDays || null, data.priority || 'none',
                    JSON.stringify(data.labels || []), data.section || 'inbox',
                    data.recurrence ? JSON.stringify(data.recurrence) : null,
                    data.pertProjectId || null, data.pertTaskId || null,
                    data.pertProjectName || null, data.parentId || null,
                    data.createdAt, data.updatedAt
                ]
            );
            count++;
            if (count % 20 === 0) {
                console.log(`  ${count}/${todoFiles.length} todos...`);
            }
        }
        console.log(`✅ ${todoFiles.length} todos migrated`);

        // Verify
        const projectCount = await client.query('SELECT COUNT(*) FROM projects');
        const todoCount = await client.query('SELECT COUNT(*) FROM todos');
        console.log(`\n📊 Database now has:`);
        console.log(`   Projects: ${projectCount.rows[0].count}`);
        console.log(`   Todos:    ${todoCount.rows[0].count}`);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
