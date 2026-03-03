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
    calendarStart?: string;
    calendarEnd?: string;
}

export default function NodeComponent({ data }: { data: NodeData }) {
    const d = data;
    const criticalColor = d.isCritical ? 'var(--accent-critical)' : 'var(--border-color)';

    return (
        <div
            style={{
                background: 'var(--bg-node)',
                border: `2px solid ${criticalColor}`,
                borderRadius: '10px',
                padding: '10px 14px',
                minWidth: '200px',
                fontFamily: 'Inter, sans-serif',
                color: 'var(--text-main)',
                boxShadow: d.isCritical ? `0 0 12px ${criticalColor}40` : 'none',
            }}
        >
            <Handle type="target" position={Position.Left} style={{ background: criticalColor }} />
            <Handle type="source" position={Position.Right} style={{ background: criticalColor }} />

            <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {d.name}
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
                    <div style={{ color: d.isCritical ? 'var(--accent-critical)' : 'var(--text-main)', fontWeight: d.isCritical ? 'bold' : 'normal' }}>
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
