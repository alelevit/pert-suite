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

// ========================
// Suggest Missing Tasks
// ========================

const SUGGEST_TASKS_PROMPT = `
You are an expert Project Manager reviewing an existing PERT chart.
You will receive the project description and the current list of tasks.

Your job is to identify 3-7 ADDITIONAL tasks that are missing from the project plan.
Think about what's been overlooked: preparation steps, reviews, handoffs, testing, documentation, deployment, etc.

Output MUST be a valid JSON object with:
- "suggestions": An array of task objects, each with: id, name, category, optimistic, likely, pessimistic, dependencies
- "reasoning": A brief explanation of why these tasks are important

Rules:
1. IDs must be unique and NOT conflict with existing task IDs. Use format "s1", "s2", etc.
2. Dependencies can reference existing task IDs or other suggested task IDs.
3. Ensure the dependency graph remains a DAG (no cycles).
4. Suggestions should complement the existing tasks, not duplicate them.
5. Each suggested task should have a clear rationale.
6. Use reasonable time estimates based on the project context.
`;

export interface SuggestTasksResult {
    suggestions: PertTask[];
    reasoning: string;
}

export async function suggestTasks(
    projectDescription: string,
    currentTasks: PertTask[],
    apiKey: string,
    model: string = "gpt-4o",
    context?: ProjectContext
): Promise<SuggestTasksResult> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    const messages: { role: string; content: string }[] = [
        { role: "system", content: SUGGEST_TASKS_PROMPT },
        {
            role: "user",
            content: `Project Description: ${projectDescription}

Current Tasks:
${JSON.stringify(currentTasks, null, 2)}

${context ? `
Filesystem Context:
Structure:
${context.structure.join('\n')}

File Contents:
${Object.entries(context.fileContents).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}
` : ''}`
        }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to suggest tasks');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content) as SuggestTasksResult;
}

export async function mockSuggestTasks(
    currentTasks: PertTask[]
): Promise<SuggestTasksResult> {
    await new Promise(resolve => setTimeout(resolve, 1200));

    const existingIds = new Set(currentTasks.map(t => t.id));
    const lastId = currentTasks.length > 0 ? currentTasks[currentTasks.length - 1].id : '0';

    return {
        suggestions: [
            {
                id: 's1',
                name: 'Risk Assessment',
                optimistic: 1,
                likely: 2,
                pessimistic: 3,
                dependencies: existingIds.has('1') ? ['1'] : [],
                category: 'Planning'
            },
            {
                id: 's2',
                name: 'Documentation & Knowledge Transfer',
                optimistic: 1,
                likely: 2,
                pessimistic: 4,
                dependencies: [lastId],
                category: 'Documentation'
            },
            {
                id: 's3',
                name: 'Stakeholder Review',
                optimistic: 1,
                likely: 1,
                pessimistic: 2,
                dependencies: ['s2'],
                category: 'Review'
            },
        ],
        reasoning: 'These tasks cover common gaps: risk planning, documentation, and stakeholder sign-off are frequently overlooked but critical for project success.'
    };
}

// ========================
// Split Task into Subtasks
// ========================

const SPLIT_TASK_PROMPT = `
You are an expert Project Manager helping decompose a high-level task into smaller, actionable subtasks.
You will receive one task to split, along with the full project context including the project description, all sibling tasks, and which tasks depend on the target task (its predecessors and successors).

Your job is to break the given task into 2-5 MEANINGFULLY DIFFERENT subtasks that together accomplish the same work.

CRITICAL RULES FOR NAMING:
- Do NOT just prepend generic verbs like "Research", "Execute", "Review" to the parent task name. This is lazy and unhelpful.
- Each subtask must have a SPECIFIC, DISTINCT name that describes a concrete deliverable or action.
- Think about what ACTUALLY needs to happen to complete this task. What are the real steps?
- Use the project description and sibling tasks to understand the domain and produce contextually relevant subtask names.

EXAMPLE of what NOT to do:
  Task: "Make Presentation"
  BAD: "Research for Make Presentation", "Execute Make Presentation", "Review Make Presentation"
  GOOD: "Conduct Topic Research & Gather Data", "Design Slide Deck & Write Content", "Rehearse Presentation & Gather Feedback"

EXAMPLE of what NOT to do:
  Task: "Deploy educational materials to sites"
  BAD: "Research Deploy educational materials", "Execute Deploy educational materials", "Finalize Deploy educational materials"
  GOOD: "Package & Format Materials for Distribution", "Upload Materials to Each Site Platform", "Verify Accessibility & Send Notification to Staff"

Output MUST be a valid JSON object with:
- "subtasks": An array of task objects, each with: id, name, category, optimistic, likely, pessimistic, dependencies
- "summary": A brief description of how you broke down the task

Rules:
1. Subtask IDs must use the format "split1", "split2", etc.
2. Subtasks should be sequentially dependent by default (split1 -> split2 -> split3), unless parallel work makes sense.
3. The FIRST subtask should have NO dependencies within the subtask set (it will inherit the parent's incoming dependencies).
4. The total estimated time of all subtasks should be roughly equal to the original task's time.
5. Keep the same category as the parent task, or use a more specific sub-category.
6. Subtask names must be CONCRETE, SPECIFIC, and DOMAIN-RELEVANT. Reference the project context.
7. Do NOT include the original task — only return the new subtasks that replace it.
`;

export interface SplitTaskResult {
    subtasks: PertTask[];
    summary: string;
}

export async function splitTask(
    taskToSplit: PertTask,
    projectDescription: string,
    allTasks: PertTask[],
    apiKey: string,
    model: string = "gpt-4o"
): Promise<SplitTaskResult> {
    if (!apiKey) {
        throw new Error("API Key is required");
    }

    // Build predecessor/successor context so the AI understands placement
    const predecessors = allTasks.filter(t => taskToSplit.dependencies.includes(t.id));
    const successors = allTasks.filter(t => t.dependencies.includes(taskToSplit.id));
    const siblings = allTasks.filter(t => t.id !== taskToSplit.id);

    const messages: { role: string; content: string }[] = [
        { role: "system", content: SPLIT_TASK_PROMPT },
        {
            role: "user",
            content: `TASK TO SPLIT:
Name: "${taskToSplit.name}"
Category: ${taskToSplit.category || 'Uncategorized'}
Estimates: Optimistic=${taskToSplit.optimistic}, Likely=${taskToSplit.likely}, Pessimistic=${taskToSplit.pessimistic} days

PROJECT DESCRIPTION:
${projectDescription || '(No description provided)'}

PREDECESSOR TASKS (what happens right before this task):
${predecessors.length > 0 ? predecessors.map(t => `- "${t.name}" (${t.category || 'Uncategorized'})`).join('\n') : '- None (this is a starting task)'}

SUCCESSOR TASKS (what depends on this task):
${successors.length > 0 ? successors.map(t => `- "${t.name}" (${t.category || 'Uncategorized'})`).join('\n') : '- None (this is a terminal task)'}

ALL OTHER TASKS IN THE PROJECT (for domain context):
${siblings.map(t => `- "${t.name}" (${t.category || 'Uncategorized'}, ${t.likely} days)`).join('\n')}

Break "${taskToSplit.name}" into 2-5 specific, domain-relevant subtasks. Do NOT use generic verbs like "Research X" / "Execute X" / "Review X".`
        }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to split task');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content) as SplitTaskResult;
}

export async function mockSplitTask(
    taskToSplit: PertTask
): Promise<SplitTaskResult> {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const totalLikely = taskToSplit.likely;
    const third = Math.max(1, Math.round(totalLikely / 3));
    const remainder = Math.max(1, totalLikely - 2 * third);

    // Generate domain-aware mock names instead of generic "Research/Execute/Review"
    const taskLower = taskToSplit.name.toLowerCase();
    let subtaskNames: string[];

    if (taskLower.includes('deploy') || taskLower.includes('release') || taskLower.includes('launch')) {
        subtaskNames = ['Prepare Deployment Package & Config', 'Execute Rollout to Target Environment', 'Validate Deployment & Monitor Health'];
    } else if (taskLower.includes('design') || taskLower.includes('ui') || taskLower.includes('interface')) {
        subtaskNames = ['Create Wireframes & User Flows', 'Build High-Fidelity Mockups', 'Gather Feedback & Iterate on Design'];
    } else if (taskLower.includes('test') || taskLower.includes('qa') || taskLower.includes('quality')) {
        subtaskNames = ['Write Test Plan & Test Cases', 'Execute Test Suites & Log Defects', 'Triage Results & Verify Fixes'];
    } else if (taskLower.includes('present') || taskLower.includes('report') || taskLower.includes('document')) {
        subtaskNames = ['Gather Data & Outline Key Points', 'Draft Content & Create Visuals', 'Review with Stakeholders & Finalize'];
    } else if (taskLower.includes('develop') || taskLower.includes('implement') || taskLower.includes('build') || taskLower.includes('code')) {
        subtaskNames = ['Set Up Architecture & Define Interfaces', 'Implement Core Logic & Features', 'Write Tests & Code Review'];
    } else if (taskLower.includes('research') || taskLower.includes('analyze') || taskLower.includes('study')) {
        subtaskNames = ['Define Research Questions & Methodology', 'Collect & Analyze Data', 'Synthesize Findings & Write Summary'];
    } else if (taskLower.includes('train') || taskLower.includes('education') || taskLower.includes('material')) {
        subtaskNames = ['Develop Training Curriculum & Materials', 'Schedule & Conduct Sessions', 'Assess Comprehension & Gather Feedback'];
    } else {
        // Generic but still better than "Research X / Execute X"
        subtaskNames = [
            `Plan & Scope: ${taskToSplit.name}`,
            `Core Work: ${taskToSplit.name}`,
            `Validate & Deliver: ${taskToSplit.name}`,
        ];
    }

    return {
        subtasks: [
            {
                id: 'split1',
                name: subtaskNames[0],
                optimistic: Math.max(1, third - 1),
                likely: third,
                pessimistic: third + 1,
                dependencies: [],
                category: taskToSplit.category || 'Uncategorized'
            },
            {
                id: 'split2',
                name: subtaskNames[1],
                optimistic: Math.max(1, third - 1),
                likely: third,
                pessimistic: third + 2,
                dependencies: ['split1'],
                category: taskToSplit.category || 'Uncategorized'
            },
            {
                id: 'split3',
                name: subtaskNames[2],
                optimistic: Math.max(1, remainder - 1),
                likely: remainder,
                pessimistic: remainder + 1,
                dependencies: ['split2'],
                category: taskToSplit.category || 'Uncategorized'
            },
        ],
        summary: `Split "${taskToSplit.name}" into 3 focused phases with domain-specific deliverables.`
    };
}
