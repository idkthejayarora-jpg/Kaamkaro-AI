import { useEffect, useState } from 'react';
import { Download, RefreshCw, Shield } from 'lucide-react';
import { auditAPI, exportAPI, staffAPI } from '../lib/api';
import type { AuditLog as AuditLogType, Staff } from '../types';

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-green-500/10 text-green-400',
  update: 'bg-gold/10 text-gold',
  delete: 'bg-red-500/10 text-red-400',
  login:  'bg-blue-500/10 text-blue-400',
  export: 'bg-purple-500/10 text-purple-400',
};

const RESOURCE_ICONS: Record<string, string> = {
  staff: '👤', customer: '🙋', vendor: '🏢',
  interaction: '📞', task: '✅', diary: '📓',
  all: '📦',
};

export default function AuditLog() {
  const [logs, setLogs]         = useState<AuditLogType[]>([]);
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [filterUser, setFilterUser] = useState('');
  const [filterResource, setFilterResource] = useState('');
  const [loading, setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    const [l, s] = await Promise.all([
      auditAPI.list({ limit: 200, resource: filterResource || undefined, userId: filterUser || undefined }),
      staffAPI.list(),
    ]);
    setLogs(l);
    setStaff(s);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterUser, filterResource]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAPI.download();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `kaamkaro-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      // Refresh logs to show the export action
      setTimeout(load, 500);
    } finally { setExporting(false); }
  };

  const resources = [...new Set(logs.map(l => l.resource))].filter(Boolean);

  if (loading) return (
    <div className="space-y-3">{Array(6).fill(0).map((_, i) => <div key={i} className="card h-14 shimmer" />)}</div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={18} className="text-gold" />
            <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          </div>
          <p className="text-white/30 text-sm">{logs.length} events recorded</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost flex items-center gap-2">
            <RefreshCw size={14} />
          </button>
          <button onClick={handleExport} disabled={exporting} className="btn-secondary flex items-center gap-2">
            <Download size={14} />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export Data'}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select className="input w-auto flex-1 min-w-36"
          value={filterUser} onChange={e => setFilterUser(e.target.value)}>
          <option value="">All users</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input w-auto flex-1 min-w-36"
          value={filterResource} onChange={e => setFilterResource(e.target.value)}>
          <option value="">All resources</option>
          {resources.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Log entries */}
      {logs.length === 0 ? (
        <div className="card text-center py-16">
          <Shield size={36} className="text-white/10 mx-auto mb-4" />
          <p className="text-white/30">No activity logged yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => (
            <div key={log.id} className="flex items-start gap-3 px-4 py-3 bg-dark-300 border border-dark-50 rounded-xl hover:border-dark-50/80 transition-colors">
              <span className="text-base flex-shrink-0 mt-0.5">{RESOURCE_ICONS[log.resource] || '🔧'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-medium text-sm">{log.userName}</span>
                  <span className={`badge text-[10px] ${ACTION_STYLES[log.action] || 'bg-white/5 text-white/40'}`}>
                    {log.action}
                  </span>
                  <span className="badge badge-gray text-[10px]">{log.resource}</span>
                </div>
                {log.details && <p className="text-white/30 text-xs mt-0.5 truncate">{log.details}</p>}
              </div>
              <span className="text-white/20 text-[10px] flex-shrink-0 mt-0.5 whitespace-nowrap">
                {new Date(log.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{' '}
                {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
