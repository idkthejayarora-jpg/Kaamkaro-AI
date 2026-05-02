import { useEffect, useRef, useState } from 'react';
import { Plus, X, Trash2, Copy, FileText, Paperclip, Image, File, CheckCheck, ExternalLink } from 'lucide-react';
import { templatesAPI } from '../lib/api';
import type { Template, TemplateAttachment, PipelineStatus } from '../types';

const TYPE_OPTS = ['general', 'call', 'message', 'email', 'meeting'] as const;
const STAGES: { key: PipelineStatus; label: string }[] = [
  { key: 'lead', label: 'Lead' }, { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' }, { key: 'negotiating', label: 'Negotiating' },
  { key: 'closed', label: 'Closed' }, { key: 'churned', label: 'Churned' },
];

const SERVER = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

function AttachmentThumb({ att }: { att: TemplateAttachment }) {
  const isImage = att.mimetype.startsWith('image/');
  const url = `${SERVER}${att.url}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 px-2.5 py-1.5 bg-dark-200 hover:bg-dark-100 border border-dark-50 rounded-xl transition-colors group"
    >
      {isImage
        ? <Image size={12} className="text-blue-400 flex-shrink-0" />
        : <File size={12} className="text-red-400 flex-shrink-0" />}
      <span className="text-white/50 text-[11px] truncate max-w-[120px] group-hover:text-white transition-colors">
        {att.originalName}
      </span>
      <ExternalLink size={10} className="text-white/20 flex-shrink-0" />
    </a>
  );
}

function AddTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Template) => void }) {
  const [form, setForm]       = useState({ title: '', content: '', stage: '' as PipelineStatus | '', type: 'general' as Template['type'] });
  const [files, setFiles]     = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const fileRef               = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.content) { setError('Title and content required'); return; }
    setLoading(true);
    try {
      let t: Template = await templatesAPI.create({ ...form, stage: form.stage || null });
      // Upload any attached files
      for (const file of files) {
        t = await templatesAPI.attach(t.id, file);
      }
      onCreated(t);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dark-300 border border-dark-50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-50 flex-shrink-0">
          <h2 className="text-white font-semibold">Add Template</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>}
          <div>
            <label className="label">Title *</label>
            <input className="input" placeholder="e.g. Bridal catalogue intro" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as Template['type'] }))}>
                {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">For Stage (optional)</label>
              <select className="input" value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value as PipelineStatus | '' }))}>
                <option value="">Any stage</option>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Message / Script *</label>
            <textarea className="input resize-none" rows={5}
              placeholder="Write the message template. Use {name}, {phone}, {place} for placeholders."
              value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
            <p className="text-white/20 text-xs mt-1">{form.content.length} chars</p>
          </div>

          {/* File attachments */}
          <div>
            <label className="label">Catalogue / Images (optional)</label>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 w-full border border-dashed border-dark-50 hover:border-gold/40 rounded-xl px-4 py-3 text-white/30 hover:text-white transition-colors text-sm">
              <Paperclip size={14} />
              Attach PDF or images (max 25 MB each)
            </button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={e => { if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-dark-200 border border-dark-50 rounded-lg px-2.5 py-1.5">
                    {f.type.startsWith('image/') ? <Image size={11} className="text-blue-400" /> : <File size={11} className="text-red-400" />}
                    <span className="text-white/60 text-[11px] max-w-[100px] truncate">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-white/20 hover:text-red-400 ml-0.5"><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
        <div className="px-6 pb-6 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Saving...' : 'Add Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [filter, setFilter]       = useState('all');
  const [copied, setCopied]       = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRefs                  = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    templatesAPI.list().then((t: Template[]) => { setTemplates(t); setLoading(false); });
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await templatesAPI.delete(id);
    setTemplates(t => t.filter(x => x.id !== id));
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
    await templatesAPI.use(id);
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t));
  };

  const handleAttach = async (id: string, file: File) => {
    setUploading(id);
    try {
      const updated: Template = await templatesAPI.attach(id, file);
      setTemplates(prev => prev.map(t => t.id === id ? updated : t));
    } catch { /* silent */ } finally { setUploading(null); }
  };

  const handleRemoveAttachment = async (templateId: string, filename: string) => {
    const updated: Template = await templatesAPI.removeAttachment(templateId, filename);
    setTemplates(prev => prev.map(t => t.id === templateId ? updated : t));
  };

  const filtered = templates.filter(t => filter === 'all' || t.type === filter);

  if (loading) return <div className="space-y-3">{Array(4).fill(0).map((_, i) => <div key={i} className="card h-20 shimmer" />)}</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText size={24} className="text-gold" />
            Templates
          </h1>
          <p className="text-white/30 text-sm mt-1">Message scripts and catalogues for your team</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={14} />Add Template
        </button>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...TYPE_OPTS].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${filter === t ? 'bg-gold text-dark-500' : 'border border-dark-50 text-white/40 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <FileText size={36} className="text-white/10 mb-4" />
          <p className="text-white/40 font-medium">No templates yet</p>
          <p className="text-white/20 text-sm mt-1">Add scripts, message templates, or catalogue PDFs</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">Add First Template</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => {
            const attachments = t.attachments || [];
            return (
              <div key={t.id} className="card group">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-white font-semibold">{t.title}</p>
                      <span className="badge badge-gold capitalize">{t.type}</span>
                      {t.stage && <span className="badge badge-gray capitalize">{t.stage}</span>}
                      {attachments.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-full">
                          <Paperclip size={9} /> {attachments.length}
                        </span>
                      )}
                    </div>
                    <p className="text-white/40 text-sm leading-relaxed line-clamp-2">{t.content}</p>

                    {/* Attachments row */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {attachments.map(att => (
                          <div key={att.name} className="flex items-center gap-1 group/att">
                            <AttachmentThumb att={att} />
                            <button
                              onClick={() => handleRemoveAttachment(t.id, att.name)}
                              className="opacity-0 group-hover/att:opacity-100 p-0.5 text-white/20 hover:text-red-400 transition-all"
                              title="Remove"
                            ><X size={10} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="text-white/20 text-xs mt-2">
                      by {t.createdByName} · used {t.usageCount} times
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Attach file */}
                    <button
                      onClick={() => fileRefs.current[t.id]?.click()}
                      disabled={uploading === t.id}
                      className="p-2 rounded-lg hover:bg-dark-200 text-white/30 hover:text-blue-400 transition-colors"
                      title="Attach PDF or image"
                    >
                      {uploading === t.id ? <span className="text-[10px] text-white/30">…</span> : <Paperclip size={14} />}
                    </button>
                    <input
                      ref={el => { fileRefs.current[t.id] = el; }}
                      type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleAttach(t.id, e.target.files[0]); e.target.value = ''; }}
                    />
                    {/* Copy */}
                    <button
                      onClick={() => handleCopy(t.id, t.content)}
                      className={`p-2 rounded-lg transition-all ${copied === t.id ? 'bg-green-500/10 text-green-400' : 'hover:bg-dark-200 text-white/30 hover:text-white'}`}
                      title="Copy message to clipboard"
                    >
                      {copied === t.id ? <CheckCheck size={14} /> : <Copy size={14} />}
                    </button>
                    {/* Delete */}
                    <button onClick={() => handleDelete(t.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddTemplateModal onClose={() => setShowAdd(false)} onCreated={t => { setTemplates(p => [...p, t]); setShowAdd(false); }} />}
    </div>
  );
}
