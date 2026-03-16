import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';

function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NodeData {
    name: string;
    duration: number;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    slack: number;
    isCritical: boolean;
    isCompleted?: boolean;
    onUncomplete?: () => void;
    onSplit?: () => void;
    calendarStart?: string;
    calendarEnd?: string;
}

export default function NodeComponent({ data }: { data: NodeData }) {
    const d = data;
    const [hovered, setHovered] = useState(false);

    // Completed tasks get green styling, overriding critical path
    const borderColor = d.isCompleted
        ? 'var(--accent-success)'
        : d.isCritical ? 'var(--accent-critical)' : 'var(--border-color)';

    const completedOpacity = d.isCompleted ? 0.55 : 1;

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: d.isCompleted ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-node)',
                border: `2px solid ${borderColor}`,
                borderRadius: '10px',
                padding: '10px 14px',
                minWidth: '200px',
                fontFamily: 'Inter, sans-serif',
                color: 'var(--text-main)',
                boxShadow: d.isCompleted
                    ? '0 0 12px rgba(34, 197, 94, 0.15)'
                    : d.isCritical ? `0 0 12px var(--accent-critical)40` : 'none',
                opacity: completedOpacity,
                transition: 'opacity 0.3s ease, background 0.3s ease',
                position: 'relative',
            }}
        >
            {/* Split button on hover */}
            {hovered && !d.isCompleted && d.onSplit && (
                <button
                    onClick={(e) => { e.stopPropagation(); d.onSplit!(); }}
                    title="Split into subtasks"
                    style={{
                        position: 'absolute',
                        top: '-10px',
                        right: '-10px',
                        padding: '3px 7px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'var(--accent-primary)',
                        border: 'none',
                        borderRadius: '6px',
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        zIndex: 10,
                    }}
                >
                    ✂️ Split
                </button>
            )}
            <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
            <Handle type="source" position={Position.Right} style={{ background: borderColor }} />

            <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {d.isCompleted && <span style={{ color: 'var(--accent-success)', fontSize: '14px', flexShrink: 0 }}>✓</span>}
                <span style={{ textDecoration: d.isCompleted ? 'line-through' : 'none', opacity: d.isCompleted ? 0.7 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.name}</span>
                {d.isCompleted && d.onUncomplete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); d.onUncomplete!(); }}
                        title="Mark incomplete"
                        style={{
                            flexShrink: 0,
                            padding: '2px 6px',
                            fontSize: '10px',
                            fontWeight: 600,
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        ↩ Undo
                    </button>
                )}
            </div>

            {/* Calendar Date Range */}
            {d.calendarStart && d.calendarEnd && (
                <div style={{
                    fontSize: '11px',
                    color: 'var(--accent-primary)',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    📅 {formatShortDate(d.calendarStart)} → {formatShortDate(d.calendarEnd)}
                </div>
            )}

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '4px',
                fontSize: '10px',
                textAlign: 'center',
                color: 'var(--text-muted)',
            }}>
                <div style={{ background: 'var(--bg-app)', padding: '4px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '9px' }}>ES</div>
                    <div style={{ color: 'var(--text-main)' }}>{d.earlyStart.toFixed(1)}</div>
                </div>
                <div style={{ background: 'var(--bg-app)', padding: '4px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '9px' }}>Dur</div>
                    <div style={{ color: d.isCritical && !d.isCompleted ? 'var(--accent-critical)' : 'var(--text-main)', fontWeight: d.isCritical && !d.isCompleted ? 'bold' : 'normal' }}>
                        {d.duration.toFixed(1)}
                    </div>
                </div>
                <div style={{ background: 'var(--bg-app)', padding: '4px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '9px' }}>EF</div>
                    <div style={{ color: 'var(--text-main)' }}>{d.earlyFinish.toFixed(1)}</div>
                </div>
            </div>

            <div style={{
                marginTop: '4px',
                fontSize: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                color: 'var(--text-muted)',
            }}>
                <span>LS: {d.lateStart.toFixed(1)} | LF: {d.lateFinish.toFixed(1)}</span>
                <span style={{
                    fontWeight: 'bold',
                    color: d.slack === 0 ? 'var(--accent-critical)' : 'var(--accent-success)',
                }}>
                    Slack: {d.slack.toFixed(1)}
                </span>
            </div>
        </div>
    );
}
