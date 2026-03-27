import { useState, useMemo, useEffect, useRef } from 'react';
import type { TodoTask } from '@pert-suite/shared';
import type { PertTask } from '../../logic/pert';
import { calculateCPM, computeCalendarDates } from '../../logic/pert';
import type { CalendarRange } from '../../logic/pert';
import GraphView from './GraphView';
import TaskReviewPage from './TaskReviewPage';
import ProjectManager from './ProjectManager';
import { Settings, Loader2, FolderOpen, Save, ListChecks, XCircle, FilePlus2, MessageSquare, Send, Link2, Unlink, Wrench, Sparkles, Scissors, CheckSquare, Square } from 'lucide-react';
import { mockGenerate, generateProjectBreakdown, continueConversation, modifyChartViaChat, mockModifyChart, suggestTasks, mockSuggestTasks, splitTask, mockSplitTask } from '../../services/llm';
import { scanDirectory, type ProjectContext } from '../../logic/fileScanner';
import { apiUpdateProject, apiMigrateFromLocalStorage, apiLinkToTodo, apiGetLinkedTodos, apiUnlinkProject, apiLoadProject } from '../../services/projectApi';


interface PertViewProps {
  allTodos?: TodoTask[];
  onOpenTodoTask?: (todoId: string) => void;
  onUncompleteTask?: (todoId: string) => void;
  pertRefreshKey?: number;
  autoLoadProjectId?: string | null;
  onProjectLoaded?: () => void;
}

const defaultExampleTasks: PertTask[] = [
  { id: '1', name: 'Define Scope', optimistic: 1, likely: 2, pessimistic: 3, dependencies: [] },
  { id: '2', name: 'Market Research', optimistic: 2, likely: 3, pessimistic: 6, dependencies: ['1'] },
  { id: '3', name: 'Technical Spec', optimistic: 1, likely: 2, pessimistic: 4, dependencies: ['1'] },
  { id: '4', name: 'Prototype', optimistic: 3, likely: 5, pessimistic: 8, dependencies: ['2', '3'] },
];

export default function PertView({ allTodos, onOpenTodoTask, onUncompleteTask, pertRefreshKey, autoLoadProjectId, onProjectLoaded }: PertViewProps) {
  // When navigating from "Go to Chart", start empty so we don't flash default tasks
  const [tasks, setTasks] = useState<PertTask[]>(autoLoadProjectId ? [] : defaultExampleTasks);
  const [isAutoLoading, setIsAutoLoading] = useState(!!autoLoadProjectId);

  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('pert_api_key') || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('pert_model') || 'gpt-4o');
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);

  // Review Mode - tasks pending review before chart
  const [pendingTasks, setPendingTasks] = useState<PertTask[] | null>(null);

  // Project Manager
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');

  // Project Start Date
  const [projectStartDate, setProjectStartDate] = useState<string>('');

  // Chat Drawer
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<'generate' | 'modify' | 'suggest'>('generate');
  const [chatFirst, setChatFirst] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'ai' | 'user', content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Suggest & Split state
  const [suggestions, setSuggestions] = useState<PertTask[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [splitTargetTask, setSplitTargetTask] = useState<PertTask | null>(null);

  // Export feedback
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Link/Sync state
  const [isLinked, setIsLinked] = useState(false);
  const [linkedCount, setLinkedCount] = useState(0);

  // Auto-migrate from localStorage on startup
  useEffect(() => {
    apiMigrateFromLocalStorage().then(count => {
      if (count > 0) {
        console.log(`Migrated ${count} projects from localStorage to file storage`);
      }
    });
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const pertNodes = useMemo(() => calculateCPM(tasks, projectStartDate || undefined), [tasks, projectStartDate]);
  // Compute calendar dates from project start date
  const calendarDates = useMemo<Map<string, CalendarRange>>(() => {
    if (!projectStartDate) return new Map();
    return computeCalendarDates(pertNodes, projectStartDate);
  }, [pertNodes, projectStartDate]);

  // Build a set of PERT task IDs whose linked Todo is completed.
  // A PERT task is only "completed" if ALL linked todos for it are completed
  // (handles duplicates from recurrence or re-linking).
  const completedPertTaskIds = useMemo<Set<string>>(() => {
    if (!isLinked || !allTodos || !currentProjectId) return new Set();
    const hasCompleted = new Set<string>();
    const hasActive = new Set<string>();
    for (const todo of allTodos) {
      if (todo.pertProjectId === currentProjectId && todo.pertTaskId) {
        if (todo.completed) {
          hasCompleted.add(todo.pertTaskId);
        } else {
          hasActive.add(todo.pertTaskId);
        }
      }
    }
    // Only mark as completed if there's at least one completed copy AND no active copies
    const completed = new Set<string>();
    for (const taskId of hasCompleted) {
      if (!hasActive.has(taskId)) {
        completed.add(taskId);
      }
    }
    return completed;
  }, [allTodos, currentProjectId, isLinked]);




  const handleLinkFolder = async () => {
    try {
      const context = await scanDirectory();
      setProjectContext(context);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        alert("Error accessing folder: " + e.message);
      }
    }
  };

  // === Generate/Chat First ===
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);

    try {
      if (chatFirst && chatHistory.length === 0 && apiKey && prompt.toLowerCase() !== 'mock') {
        const aiResponse = await continueConversation(prompt, [], apiKey, selectedModel, projectContext || undefined);
        setChatHistory([{ role: 'ai', content: aiResponse }]);
        setChatOpen(true);
        setChatMode('generate');
        setIsGenerating(false);
        return;
      }

      const fullContext = chatHistory.length > 0
        ? `${prompt}\n\nConversation:\n${chatHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
        : prompt;

      let newTasks;
      if (apiKey && prompt.toLowerCase() !== 'mock') {
        newTasks = await generateProjectBreakdown(fullContext, apiKey, selectedModel, projectContext || undefined);
      } else {
        newTasks = await mockGenerate(prompt);
      }

      setPendingTasks(newTasks);
      setChatHistory([]);
      setChatOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      alert("Error: " + msg);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Chat Reply (Generate mode) ===
  const handleChatReply = async (reply: string) => {
    const newHistory = [...chatHistory, { role: 'user' as const, content: reply }];
    setChatHistory(newHistory);

    if (apiKey) {
      setIsGenerating(true);
      try {
        const aiResponse = await continueConversation(prompt, newHistory, apiKey, selectedModel, projectContext || undefined);
        setChatHistory(prev => [...prev, { role: 'ai', content: aiResponse }]);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        alert("Error: " + msg);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  // === Modify Chart via Chat ===
  const handleModifyChat = async (message: string) => {
    const newHistory = [...chatHistory, { role: 'user' as const, content: message }];
    setChatHistory(newHistory);
    setIsGenerating(true);

    try {
      let result;
      if (apiKey) {
        result = await modifyChartViaChat(tasks, message, chatHistory, apiKey, selectedModel);
      } else {
        result = await mockModifyChart(tasks, message);
      }

      setTasks(result.tasks);
      setChatHistory(prev => [...prev, { role: 'ai', content: result.summary }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setChatHistory(prev => [...prev, { role: 'ai', content: `❌ Error: ${msg}` }]);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Suggest Tasks ===
  const handleSuggestTasks = async (_message?: string) => {
    setIsGenerating(true);
    setSuggestions(null);
    setSelectedSuggestions(new Set());

    try {
      let result;
      if (apiKey) {
        result = await suggestTasks(prompt || 'General project', tasks, apiKey, selectedModel, projectContext || undefined);
      } else {
        result = await mockSuggestTasks(tasks);
      }

      setSuggestions(result.suggestions);
      setSelectedSuggestions(new Set(result.suggestions.map(s => s.id)));
      setChatHistory(prev => [...prev, { role: 'ai', content: `${result.reasoning}\n\nI found ${result.suggestions.length} tasks you might want to add. Select the ones you'd like to include.` }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setChatHistory(prev => [...prev, { role: 'ai', content: `❌ Error: ${msg}` }]);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Split Task ===
  const handleSplitTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setSplitTargetTask(task);
    setChatMode('suggest');
    setChatOpen(true);
    setChatHistory([{ role: 'ai', content: `✂️ Breaking down "${task.name}" into smaller subtasks...` }]);
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setIsGenerating(true);

    try {
      let result;
      if (apiKey) {
        result = await splitTask(task, prompt || '', tasks, apiKey, selectedModel);
      } else {
        result = await mockSplitTask(task);
      }

      // Give subtasks unique IDs to avoid collisions
      const subtasksWithUniqueIds = result.subtasks.map(st => ({
        ...st,
        id: `${taskId}_${st.id}`,
        dependencies: st.dependencies.map(d => `${taskId}_${d}`),
      }));

      setSuggestions(subtasksWithUniqueIds);
      setSelectedSuggestions(new Set(subtasksWithUniqueIds.map(s => s.id)));
      setChatHistory(prev => [...prev, { role: 'ai', content: `${result.summary}\n\nSelect the subtasks you'd like to keep, then click "Accept" to replace the original task.` }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setChatHistory(prev => [...prev, { role: 'ai', content: `❌ Error: ${msg}` }]);
      setSplitTargetTask(null);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Accept Suggestions / Split Results ===
  const handleAcceptSuggestions = () => {
    if (!suggestions) return;

    const selected = suggestions.filter(s => selectedSuggestions.has(s.id));
    if (selected.length === 0) return;

    if (splitTargetTask) {
      // SPLIT mode: replace the parent task with selected subtasks
      const parentId = splitTargetTask.id;
      const parentDeps = splitTargetTask.dependencies;

      // First subtask inherits parent's incoming dependencies
      const firstSubtaskId = selected[0].id;
      const lastSubtaskId = selected[selected.length - 1].id;

      const rewiredSubtasks = selected.map((st, idx) => ({
        ...st,
        dependencies: idx === 0
          ? [...parentDeps, ...st.dependencies.filter(d => d !== firstSubtaskId && !parentDeps.includes(d))]
          : st.dependencies,
      }));

      // Remove parent, add subtasks, and update downstream tasks to reference last subtask
      const newTasks = tasks
        .filter(t => t.id !== parentId)
        .map(t => ({
          ...t,
          dependencies: t.dependencies.map(d => d === parentId ? lastSubtaskId : d),
        }));

      setPendingTasks([...newTasks, ...rewiredSubtasks]);
      setSplitTargetTask(null);
    } else {
      // SUGGEST mode: add selected suggestions to existing tasks
      setPendingTasks([...tasks, ...selected]);
    }

    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setChatOpen(false);
    setChatHistory([]);
  };

  const toggleSuggestionSelection = (id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // === Send chat message ===
  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || isGenerating) return;
    setChatInput('');

    if (chatMode === 'modify') {
      handleModifyChat(msg);
    } else if (chatMode === 'suggest') {
      // In suggest mode, treat chat input as a request to suggest more tasks
      setChatHistory(prev => [...prev, { role: 'user', content: msg }]);
      handleSuggestTasks(msg);
    } else {
      handleChatReply(msg);
    }
  };

  const handleConfirmTasks = (reviewedTasks: PertTask[]) => {
    setTasks(reviewedTasks);
    setPendingTasks(null);
  };

  const handleCancelReview = () => {
    setPendingTasks(null);
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('pert_api_key', key);
  };

  const saveModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('pert_model', model);
  };

  const handleLoadProject = async (loadedTasks: PertTask[], description: string, projectId: string, projectName: string) => {
    setTasks(loadedTasks);
    setPrompt(description);
    setCurrentProjectId(projectId);
    setCurrentProjectName(projectName);

    // Check if project is linked and refresh tasks from server
    // (picks up any sync-back changes from Todo edits)
    try {
      const project = await apiLoadProject(projectId);
      if (project) {
        setTasks(project.tasks as PertTask[]);
        setIsLinked(project.linked || false);
        if (project.startDate) setProjectStartDate(project.startDate);
      }
      if (project?.linked) {
        const linkedTodos = await apiGetLinkedTodos(projectId);
        setLinkedCount(linkedTodos.length);
      }
    } catch {
      // Non-fatal — just use locally loaded data
    }
  };

  // Auto-refresh PERT data when a linked todo is updated
  useEffect(() => {
    if (!pertRefreshKey || !currentProjectId || !isLinked) return;
    (async () => {
      try {
        const project = await apiLoadProject(currentProjectId);
        if (project) {
          setTasks(project.tasks as PertTask[]);
          if (project.startDate) setProjectStartDate(project.startDate);
        }
      } catch { /* non-fatal */ }
    })();
  }, [pertRefreshKey]);

  // Auto-load a specific project when navigated from "Go to Chart" button
  useEffect(() => {
    if (!autoLoadProjectId) return;
    setIsAutoLoading(true);
    (async () => {
      try {
        const project = await apiLoadProject(autoLoadProjectId);
        if (project) {
          setTasks(project.tasks as PertTask[]);
          setPrompt(project.description || '');
          setCurrentProjectId(project.id);
          setCurrentProjectName(project.name);
          setIsLinked(project.linked || false);
          if (project.startDate) setProjectStartDate(project.startDate);
          if (project.linked) {
            const linkedTodos = await apiGetLinkedTodos(project.id);
            setLinkedCount(linkedTodos.length);
          }
        }
      } catch { /* non-fatal */ }
      setIsAutoLoading(false);
      onProjectLoaded?.();
    })();
  }, [autoLoadProjectId]);

  const handleQuickSave = async () => {
    if (currentProjectId) {
      try {
        await apiUpdateProject(currentProjectId, { name: currentProjectName, description: prompt, tasks, startDate: projectStartDate || undefined });
        alert(`Project "${currentProjectName}" saved!`);
      } catch (e) {
        alert(`Failed to save: ${e}`);
      }
    } else {
      setShowProjectManager(true);
    }
  };

  // === Link to Todo (bidirectional sync) ===
  const handleLinkToTodo = async () => {
    if (!currentProjectId) {
      alert('Please save your project first before linking to Todo.');
      return;
    }

    try {
      setExportStatus('Linking...');
      // Save project first to ensure latest tasks are persisted
      await apiUpdateProject(currentProjectId, { name: currentProjectName, description: prompt, tasks, startDate: projectStartDate || undefined });

      const nodesForLink = pertNodes.map(n => ({
        id: n.id,
        name: n.name,
        optimistic: n.optimistic,
        likely: n.likely,
        pessimistic: n.pessimistic,
        dependencies: n.dependencies,
        earlyStart: n.earlyStart,
        earlyFinish: n.earlyFinish,
        duration: n.duration,
      }));

      const result = await apiLinkToTodo(currentProjectId, nodesForLink, projectStartDate || undefined);
      setIsLinked(true);
      setLinkedCount(result.total);

      const statusParts: string[] = [];
      if (result.created > 0) statusParts.push(`${result.created} created`);
      if (result.updated > 0) statusParts.push(`${result.updated} updated`);
      setExportStatus(`🔗 Linked ${result.total} tasks (${statusParts.join(', ')})`);
      setTimeout(() => setExportStatus(null), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setExportStatus(`❌ Link failed: ${msg}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  };

  const handleUnlink = async () => {
    if (!currentProjectId) return;
    try {
      await apiUnlinkProject(currentProjectId);
      setIsLinked(false);
      setLinkedCount(0);
      setExportStatus('🔓 Unlinked from Todo');
      setTimeout(() => setExportStatus(null), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setExportStatus(`❌ Unlink failed: ${msg}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', position: 'relative' }}>

      {/* Task Review Page */}
      {pendingTasks && (
        <TaskReviewPage
          tasks={pendingTasks}
          onConfirm={handleConfirmTasks}
          onCancel={handleCancelReview}
        />
      )}

      {/* Project Manager Modal */}
      {showProjectManager && (
        <ProjectManager
          currentTasks={tasks}
          currentDescription={prompt}
          onLoadProject={handleLoadProject}
          onClose={() => setShowProjectManager(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setShowSettings(false)}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '420px', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '16px' }}>PERT Settings</h2>

            <div style={{ borderTop: '1px solid var(--border-color)', marginBottom: '16px' }} />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              OpenAI API Key (Stored in LocalStorage)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => saveApiKey(e.target.value)}
              placeholder="sk-..."
              style={{
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '8px', borderRadius: '6px', color: 'var(--text-main)', marginBottom: '16px',
                width: '100%', boxSizing: 'border-box'
              }}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              LLM Model
            </label>
            <select
              value={selectedModel}
              onChange={e => saveModel(e.target.value)}
              style={{
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '8px', borderRadius: '6px', color: 'var(--text-main)', marginBottom: '24px',
                width: '100%', boxSizing: 'border-box', outline: 'none'
              }}
            >
              <optgroup label="GPT-4 Series">
                <option value="gpt-4o">GPT-4o (Recommended)</option>
                <option value="gpt-4o-mini">GPT-4o Mini (Faster)</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
              </optgroup>
              <optgroup label="GPT-3.5">
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              </optgroup>
            </select>
            <button onClick={() => setShowSettings(false)} style={{ background: 'var(--accent-primary)', padding: '8px 16px', borderRadius: '6px', width: '100%', textAlign: 'center', color: 'white' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Top Controls */}
      <div style={{ position: 'absolute', top: '16px', right: chatOpen ? '416px' : '16px', zIndex: 50, display: 'flex', gap: '8px', transition: 'right 0.3s ease' }}>
        <button
          onClick={() => {
            setTasks([]);
            setPrompt('');
            setCurrentProjectId(null);
            setCurrentProjectName('Untitled Project');
            setProjectContext(null);
            setProjectStartDate('');
          }}
          title="New Project"
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <FilePlus2 size={18} /> New
        </button>
        <button
          onClick={() => setPendingTasks([...tasks])}
          title="Edit Tasks & Dependencies"
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <ListChecks size={18} /> Edit Tasks
        </button>
        <button
          onClick={handleLinkToTodo}
          title={isLinked ? `Synced — ${linkedCount} tasks linked to Todo` : 'Link tasks to Todo for bidirectional sync'}
          style={{
            padding: '8px 12px',
            background: isLinked ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-panel)',
            borderRadius: '8px',
            border: isLinked ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '6px',
            color: isLinked ? 'var(--accent-success)' : 'var(--accent-primary)',
            fontSize: '13px', fontWeight: 500
          }}
        >
          <Link2 size={18} /> {isLinked ? `Synced (${linkedCount})` : 'Link to Todo'}
        </button>
        {isLinked && (
          <button
            onClick={handleUnlink}
            title="Unlink from Todo"
            style={{ padding: '8px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
          >
            <Unlink size={16} />
          </button>
        )}
        <button
          onClick={handleQuickSave}
          title={currentProjectId ? `Save ${currentProjectName}` : 'Save Project'}
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <Save size={18} />
          {currentProjectId ? 'Save' : 'Save As'}
        </button>
        <button
          onClick={() => setShowProjectManager(true)}
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <FolderOpen size={18} /> Projects
        </button>
        <button
          onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) { setChatHistory([]); setSuggestions(null); setSplitTargetTask(null); } }}
          title="Toggle Chat"
          style={{
            padding: '8px 12px', background: chatOpen ? 'var(--accent-primary)' : 'var(--bg-panel)',
            borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px',
            color: chatOpen ? 'white' : 'var(--text-muted)', fontSize: '13px'
          }}
        >
          <MessageSquare size={18} /> Chat
        </button>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <Settings size={20} color="var(--text-muted)" />
        </button>
      </div>

      {/* Export Status Toast */}
      {exportStatus && (
        <div style={{
          position: 'absolute', top: '64px', right: chatOpen ? '416px' : '16px', zIndex: 60,
          background: 'var(--bg-panel)', padding: '12px 20px', borderRadius: '10px',
          border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-main)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'right 0.3s ease',
          animation: 'fadeIn 0.3s ease'
        }}>
          {exportStatus}
        </div>
      )}

      {/* Graph Area */}
      <div style={{ flex: 1, background: 'var(--bg-app)', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* Loading overlay when auto-loading a project from "Go to Chart" */}
        {isAutoLoading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', zIndex: 30,
            background: 'var(--bg-app)', gap: '12px',
          }}>
            <Loader2 size={32} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading project…</span>
          </div>
        )}
        <GraphView
          pertNodes={pertNodes}
          calendarDates={calendarDates}
          completedTaskIds={completedPertTaskIds}
          onUncompleteTask={(pertTaskId) => {
            if (isLinked && allTodos && onUncompleteTask && currentProjectId) {
              const todo = allTodos.find(t => t.pertProjectId === currentProjectId && t.pertTaskId === pertTaskId);
              if (todo) onUncompleteTask(todo.id);
            }
          }}
          onNodeClick={(nodeId) => {
            if (isLinked && allTodos && onOpenTodoTask && currentProjectId) {
              const todo = allTodos.find(t => t.pertProjectId === currentProjectId && t.pertTaskId === nodeId);
              if (todo) onOpenTodoTask(todo.id);
            }
          }}
          onSplitTask={handleSplitTask}
        />

        {/* Generation Input */}
        <div style={{
          position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-panel)', backdropFilter: 'blur(8px)', padding: '16px',
          borderRadius: '16px', border: '1px solid var(--border-color)', display: 'flex', gap: '8px',
          boxShadow: 'var(--shadow-md)', width: '600px', maxWidth: '90%'
        }}>
          {/* Chat First Toggle */}
          <button
            onClick={() => setChatFirst(!chatFirst)}
            title={chatFirst ? "Chat First (ON) - AI will ask clarifying questions before generating" : "Chat First (OFF) - Generate tasks directly"}
            style={{
              background: chatFirst ? 'var(--accent-primary)' : 'var(--bg-card, var(--bg-panel))',
              padding: '8px', borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            <MessageSquare size={18} color={chatFirst ? 'white' : 'var(--text-muted)'} />
          </button>

          <button
            onClick={handleLinkFolder}
            title="Link local project folder for context"
            style={{
              background: projectContext ? 'var(--accent-success)' : 'var(--bg-card, var(--bg-panel))',
              padding: '8px', borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            <FolderOpen size={18} color={projectContext ? 'white' : 'var(--text-muted)'} />
            {projectContext && <span style={{ fontSize: '10px', color: 'white' }}>Linked</span>}
          </button>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder={chatFirst ? "Describe project (AI will ask questions first)..." : "Describe your project to generate tasks..."}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '14px', outline: 'none' }}
            />
            {projectContext && (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{projectContext.structure.length} files scanned</span>
                <button onClick={() => setProjectContext(null)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}>
                  <XCircle size={12} color="var(--accent-critical)" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              background: 'var(--accent-primary)', color: 'white', padding: '8px 16px',
              borderRadius: '8px', fontWeight: 600, fontSize: '14px', opacity: isGenerating ? 0.7 : 1,
              minWidth: '100px', display: 'flex', justifyContent: 'center', alignItems: 'center'
            }}
          >
            {isGenerating ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : (chatFirst && chatHistory.length === 0 ? 'Chat First' : 'Generate')}
          </button>
        </div>
      </div>

      {/* Chat Drawer (Right Side) */}
      {chatOpen && (
        <div style={{
          width: '400px',
          borderLeft: '1px solid var(--border-color)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          animation: 'slideInRight 0.3s ease'
        }}>
          {/* Drawer Header */}
          <div style={{
            padding: '16px', borderBottom: '1px solid var(--border-color)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '16px', margin: 0 }}>AI Assistant</h2>
            </div>
            <button
              onClick={() => { setChatOpen(false); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
            >
              <XCircle size={18} color="var(--text-muted)" />
            </button>
          </div>

          {/* Mode Toggle */}
          <div style={{
            padding: '8px 16px', borderBottom: '1px solid var(--border-color)',
            display: 'flex', gap: '4px'
          }}>
            <button
              onClick={() => { setChatMode('generate'); setChatHistory([]); }}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: chatMode === 'generate' ? 'var(--accent-primary)' : 'var(--bg-card, var(--bg-panel))',
                color: chatMode === 'generate' ? 'white' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              <Sparkles size={14} /> New Project
            </button>
            <button
              onClick={() => { setChatMode('modify'); setChatHistory([]); setSuggestions(null); setSplitTargetTask(null); }}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: chatMode === 'modify' ? 'var(--accent-primary)' : 'var(--bg-card, var(--bg-panel))',
                color: chatMode === 'modify' ? 'white' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              <Wrench size={14} /> Modify Chart
            </button>
            <button
              onClick={() => { setChatMode('suggest'); setChatHistory([]); setSuggestions(null); setSplitTargetTask(null); }}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: chatMode === 'suggest' ? 'var(--accent-primary)' : 'var(--bg-card, var(--bg-panel))',
                color: chatMode === 'suggest' ? 'white' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              <Scissors size={14} /> Suggest & Split
            </button>
          </div>

          {/* Chat Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {chatHistory.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.3 }}>
                  {chatMode === 'modify' ? '🛠️' : chatMode === 'suggest' ? '✂️' : '✨'}
                </div>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  {chatMode === 'modify'
                    ? 'Ask me to modify your chart'
                    : chatMode === 'suggest'
                    ? 'I can suggest missing tasks or split existing ones'
                    : 'Ask me to help plan your project'}
                </p>
                <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', maxWidth: '280px', margin: '0 auto' }}>
                  {chatMode === 'modify' ? (
                    <>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Add a task called "Code Review" that takes 2 days')}>
                        💡 "Add a task called 'Code Review' that takes 2 days"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Remove the "Market Research" task')}>
                        💡 "Remove the 'Market Research' task"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Make the Prototype task take 10 days instead of 5')}>
                        💡 "Make the Prototype task take 10 days"
                      </div>
                    </>
                  ) : chatMode === 'suggest' ? (
                    <>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => { handleSuggestTasks(); }}>
                        ✨ Suggest missing tasks for my project
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)' }}>
                        💡 Tip: Hover over a node in the chart and click ✂️ to split it
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('What are the key milestones?')}>
                        💡 "What are the key milestones?"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('How should we handle testing?')}>
                        💡 "How should we handle testing?"
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div key={i} style={{
                padding: '10px 14px',
                borderRadius: '12px',
                maxWidth: '90%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-app)',
                color: 'var(--text-main)',
                fontSize: '13px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                border: msg.role === 'ai' ? '1px solid var(--border-color)' : 'none'
              }}>
                {msg.content}
              </div>
            ))}

            {/* Suggestion Cards */}
            {suggestions && suggestions.length > 0 && (
              <div style={{
                padding: '12px',
                background: 'var(--bg-app)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                  {splitTargetTask ? `Subtasks for "${splitTargetTask.name}"` : 'Suggested Tasks'}
                </div>
                {suggestions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => toggleSuggestionSelection(s.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: selectedSuggestions.has(s.id) ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: selectedSuggestions.has(s.id) ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-panel)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {selectedSuggestions.has(s.id)
                      ? <CheckSquare size={16} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: '1px' }} />
                      : <Square size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: '1px' }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {s.category && <span>{s.category} • </span>}
                        O: {s.optimistic} | M: {s.likely} | P: {s.pessimistic} days
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={handleAcceptSuggestions}
                  disabled={selectedSuggestions.size === 0}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    padding: '10px',
                    background: selectedSuggestions.size > 0 ? 'var(--accent-success)' : 'var(--bg-card, var(--bg-panel))',
                    color: selectedSuggestions.size > 0 ? 'white' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: selectedSuggestions.size > 0 ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  ✓ Accept {selectedSuggestions.size} {splitTargetTask ? 'Subtask' : 'Task'}{selectedSuggestions.size !== 1 ? 's' : ''}
                </button>
              </div>
            )}

            {isGenerating && (
              <div style={{
                padding: '10px 14px', borderRadius: '12px', alignSelf: 'flex-start',
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Thinking...
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--border-color)',
            display: 'flex', gap: '8px'
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
              placeholder={chatMode === 'modify' ? 'Ask to modify the chart...' : chatMode === 'suggest' ? 'Ask for task suggestions...' : 'Continue the conversation...'}
              disabled={isGenerating}
              style={{
                flex: 1,
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '10px 14px', borderRadius: '8px', color: 'var(--text-main)', outline: 'none',
                fontSize: '13px'
              }}
            />
            <button
              onClick={handleSendChat}
              disabled={isGenerating || !chatInput.trim()}
              style={{
                background: 'var(--accent-primary)', color: 'white', padding: '10px 14px',
                borderRadius: '8px', border: 'none', cursor: 'pointer',
                opacity: isGenerating || !chatInput.trim() ? 0.5 : 1,
                display: 'flex', alignItems: 'center'
              }}
              title="Send message"
            >
              <Send size={16} />
            </button>
          </div>

          {/* Generate button (only in generate mode with history) */}
          {chatMode === 'generate' && chatHistory.length > 0 && (
            <div style={{ padding: '0 16px 12px' }}>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  width: '100%',
                  background: 'var(--accent-success)', color: 'white', padding: '10px 16px',
                  borderRadius: '8px', fontWeight: 600, fontSize: '13px', border: 'none', cursor: 'pointer',
                  opacity: isGenerating ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
              >
                ✓ Done — Generate Tasks
              </button>
            </div>
          )}
        </div>
      )}


      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
