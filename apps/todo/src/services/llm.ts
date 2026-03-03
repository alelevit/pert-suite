import type { PertTask } from '../logic/pert';

export interface ProjectBreakdown {
    tasks: PertTask[];
}

const SYSTEM_PROMPT = `
You are an expert Project Manager and PERT Chart Specialist.
Your goal is to break down a project into a specific list of tasks suitable for a PERT chart.

You will be provided with a project description and, optionally, context from a local project directory (file structure and content from key files).

Your task:
1. Analyze the description and any provided filesystem context.
2. Infer the logical task breakdown (Sub-systems, dependencies, etc.)
3. Group tasks into logical categories (e.g., "Planning", "Development", "Testing", "Deployment")
4. Estimate:
   - Optimistic Time (O): Everything goes perfectly.
   - Most Likely Time (M): Normal conditions.
   - Pessimistic Time (P): Risk events occur.

Output MUST be a valid JSON object with a single key "tasks", which is an array of objects.
Each object must have:
- "id": A unique string ID (e.g., "1", "2", "3").
- "name": Short, one-line action-oriented name.
- "category": Category this task belongs to (e.g., "Planning", "Development", "Analysis", "Testing").
- "optimistic": Number (hours/days).
- "likely": Number.
- "pessimistic": Number.
- "dependencies": Array of IDs of tasks that must finish before this one starts.

Rules:
1. Ensure the dependency graph is a DAG (Directed Acyclic Graph). No circles.
2. IDs must be consistent strings.
3. If filesystem context is provided, use it to make tasks more specific and accurate to the existing code/docs.
4. Provide at least 5-10 tasks for a decent chart.
5. Group related tasks under common categories.
`;

import type { ProjectContext } from '../logic/fileScanner';

export async function generateProjectBreakdown(
    description: string,
    apiKey: string,
    model: string = "gpt-4o",
    context?: ProjectContext
): Promise<PertTask[]> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: `Project Description: ${description}
                    
                    ${context ? `
                    Filesystem Context:
                    Structure:
                    ${context.structure.join('\n')}
                    
                    File Contents:
                    ${Object.entries(context.fileContents).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}
                    ` : ''}`
                }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch plan from LLM');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const result = JSON.parse(content) as ProjectBreakdown;
    return result.tasks;
}

export async function mockGenerate(description: string): Promise<PertTask[]> {
    await new Promise(resolve => setTimeout(resolve, 1500));

    return [
        { id: 'm1', name: 'Analyze ' + description.slice(0, 20), optimistic: 1, likely: 2, pessimistic: 3, dependencies: [] },
        { id: 'm2', name: 'Draft Plan', optimistic: 2, likely: 4, pessimistic: 6, dependencies: ['m1'] },
        { id: 'm3', name: 'Review Requirements', optimistic: 1, likely: 2, pessimistic: 3, dependencies: ['m1'] },
        { id: 'm4', name: 'Implementation', optimistic: 5, likely: 8, pessimistic: 15, dependencies: ['m2', 'm3'] },
        { id: 'm5', name: 'Testing', optimistic: 2, likely: 3, pessimistic: 5, dependencies: ['m4'] },
        { id: 'm6', name: 'Deployment', optimistic: 1, likely: 1, pessimistic: 2, dependencies: ['m5'] },
    ];
}

const CLARIFICATION_PROMPT = `
You are an expert Project Manager preparing to build a PERT chart.
Before generating task breakdowns, you need to ask clarifying questions to understand the project scope.

Your goal is to ask 3-5 focused questions that will help you:
1. Understand the project's scope and boundaries
2. Identify key deliverables and milestones
3. Clarify technical requirements or constraints
4. Understand team size and skill considerations
5. Identify any external dependencies or deadlines

Output MUST be a valid JSON object with a single key "questions", which is an array of strings.
Each string is a concise, specific question.

Example output:
{
  "questions": [
    "What is the target deadline for this project?",
    "How many developers will be working on this?",
    "Are there any existing systems this needs to integrate with?"
  ]
}
`;

export interface ClarificationResponse {
    questions: string[];
}

export async function askClarifyingQuestions(
    description: string,
    apiKey: string,
    model: string = "gpt-4o",
    context?: ProjectContext
): Promise<string[]> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: CLARIFICATION_PROMPT },
                {
                    role: "user",
                    content: `Project Description: ${description}
                    
                    ${context ? `
                    Filesystem Context:
                    Structure:
                    ${context.structure.join('\n')}
                    
                    File Contents:
                    ${Object.entries(context.fileContents).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}
                    ` : ''}`
                }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch clarifying questions');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const result = JSON.parse(content) as ClarificationResponse;
    return result.questions;
}

const CONVERSATION_PROMPT = `
You are an expert Project Manager having a conversation to understand a project before building a PERT chart.

Your role is to:
1. Ask follow-up questions to clarify scope, requirements, and constraints
2. Acknowledge what the user has shared
3. Dig deeper into unclear areas
4. Help the user think through aspects they may have missed

Keep your responses conversational but focused. Ask 1-3 follow-up questions at a time.
When you feel you have enough information, let the user know they can proceed to generate the task breakdown.

Output a natural conversational response (plain text, not JSON).
`;

export async function continueConversation(
    projectDescription: string,
    chatHistory: { role: 'ai' | 'user', content: string }[],
    apiKey: string,
    model: string = "gpt-4o",
    context?: ProjectContext
): Promise<string> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    // Build messages from chat history
    const messages: { role: string, content: string }[] = [
        { role: "system", content: CONVERSATION_PROMPT },
        {
            role: "user",
            content: `Project Description: ${projectDescription}
            
            ${context ? `
            Filesystem Context:
            Structure:
            ${context.structure.join('\n')}
            
            File Contents:
            ${Object.entries(context.fileContents).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}
            ` : ''}`
        }
    ];

    // Add chat history
    for (const msg of chatHistory) {
        messages.push({
            role: msg.role === 'ai' ? 'assistant' : 'user',
            content: msg.content
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: messages,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to continue conversation');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// ========================
// Modify Chart via Chat
// ========================

const MODIFY_CHART_PROMPT = `
You are an expert Project Manager helping modify an existing PERT chart.
You will receive the current list of tasks and a user request to modify them.

Your job is to apply the requested changes and return the FULL updated task list.

Supported modifications:
- Add new tasks (generate unique IDs like "new1", "new2", etc.)
- Remove tasks (remove them and clean up any dependencies referencing them)
- Rename tasks
- Change time estimates (optimistic, likely, pessimistic)
- Modify dependencies
- Move tasks to different categories

Output MUST be a valid JSON object with:
- "tasks": The complete updated array of all tasks (not just the changed ones)
- "summary": A brief description of what was changed

Each task must have: id, name, optimistic, likely, pessimistic, dependencies, category (optional).

Rules:
1. Preserve all unchanged tasks exactly as-is.
2. Ensure the dependency graph remains a DAG (no cycles).
3. When removing a task, remove it from all other tasks' dependencies.
4. Use reasonable defaults for new tasks if the user doesn't specify everything.
`;

export interface ModifyChartResult {
    tasks: PertTask[];
    summary: string;
}

export async function modifyChartViaChat(
    currentTasks: PertTask[],
    userMessage: string,
    chatHistory: { role: 'ai' | 'user', content: string }[],
    apiKey: string,
    model: string = "gpt-4o"
): Promise<ModifyChartResult> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    const messages: { role: string; content: string }[] = [
        { role: "system", content: MODIFY_CHART_PROMPT },
        {
            role: "user",
            content: `Current tasks:\n${JSON.stringify(currentTasks, null, 2)}`
        }
    ];

    // Add chat history
    for (const msg of chatHistory) {
        messages.push({
            role: msg.role === 'ai' ? 'assistant' : 'user',
            content: msg.content
        });
    }

    // Add the new user message
    messages.push({ role: "user", content: userMessage });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.5,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to modify chart');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const result = JSON.parse(content) as ModifyChartResult;
    return result;
}

/**
 * Mock fallback for modifying chart without an API key.
 * Handles simple add/remove patterns.
 */
export async function mockModifyChart(
    currentTasks: PertTask[],
    userMessage: string
): Promise<ModifyChartResult> {
    await new Promise(resolve => setTimeout(resolve, 800));

    const lower = userMessage.toLowerCase();
    let tasks = [...currentTasks];
    let summary = '';

    if (lower.includes('add') || lower.includes('new task')) {
        // Extract a name from quotes or use generic
        const match = userMessage.match(/["']([^"']+)["']/);
        const name = match ? match[1] : 'New Task';
        const newId = 'new' + Math.random().toString(36).substring(2, 6);
        tasks.push({
            id: newId,
            name,
            optimistic: 1,
            likely: 3,
            pessimistic: 5,
            dependencies: [],
        });
        summary = `Added task "${name}" (ID: ${newId})`;
    } else if (lower.includes('remove') || lower.includes('delete')) {
        const match = userMessage.match(/["']([^"']+)["']/);
        if (match) {
            const nameToRemove = match[1].toLowerCase();
            const toRemove = tasks.find(t => t.name.toLowerCase().includes(nameToRemove));
            if (toRemove) {
                tasks = tasks
                    .filter(t => t.id !== toRemove.id)
                    .map(t => ({
                        ...t,
                        dependencies: t.dependencies.filter(d => d !== toRemove.id)
                    }));
                summary = `Removed task "${toRemove.name}"`;
            } else {
                summary = `Could not find task matching "${match[1]}"`;
            }
        } else {
            summary = 'Please specify which task to remove (use quotes around the name)';
        }
    } else {
        summary = 'I understood your request but could not apply it in demo mode. Please connect an API key for full modification support.';
    }

    return { tasks, summary };
}
