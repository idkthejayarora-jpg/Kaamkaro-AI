import { useEffect, useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { pdfAPI } from '../lib/api';
import type { PDFEntry } from '../types';

function StatusIcon({ status }: { status: PDFEntry['status'] }) {
  if (status === 'done')       return <CheckCircle size={16} className="text-green-400" />;
  if (status === 'processing') return <Clock size={16} className="text-gold animate-pulse" />;
  return <AlertCircle size={16} className="text-red-400" />;
}

function EntryCard({ entry }: { entry: PDFEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-dark-200 border border-dark-50 flex items-center justify-center flex-shrink-0">
            <FileText size={15} className="text-white/40" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-medium truncate">{entry.fileName}</p>
            <p className="text-white/30 text-xs">
              {new Date(entry.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusIcon status={entry.status} />
          <span className={`badge text-[10px] ${entry.status === 'done' ? 'badge-green' : entry.status === 'processing' ? 'badge-gold' : 'badge-red'}`}>
            {entry.status}
          </span>
        </div>
      </div>

      {entry.status === 'done' && entry.entries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-dark-50/50">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-2 text-white/50 hover:text-white text-xs font-medium transition-colors w-full"
          >
            <Sparkles size={12} className="text-gold" />
            <span>{entry.entries.length} entries extracted by AI</span>
            {expanded ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
          </button>

          {expanded && (
            <div className="mt-3 space-y-3 animate-fade-in">
              {entry.entries.map((e, i) => (
                <div key={i} className="bg-dark-200 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-sm">{e.customerName}</span>
                      {e.matchedCustomerName && (
                        <span className="badge badge-gold text-[10px]">Matched</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.sentiment && (
                        <span className={`badge text-[10px] ${
                          e.sentiment === 'positive' ? 'badge-green' :
                          e.sentiment === 'negative' ? 'badge-red' : 'badge-gray'
                        }`}>{e.sentiment}</span>
                      )}
                      <span className="text-white/20 text-[10px]">{Math.round(e.confidence * 100)}% conf.</span>
                    </div>
                  </div>
                  {e.date && <p className="text-white/30 text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</p>}
                  <p className="text-white/60 text-xs leading-relaxed">{e.notes}</p>
                  {e.actionItems && e.actionItems.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {e.actionItems.map((a, j) => (
                        <span key={j} className="badge badge-gray text-[10px]">{a}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {entry.status === 'processing' && (
        <div className="mt-3 pt-3 border-t border-dark-50/50">
          <div className="flex items-center gap-2 text-gold/60 text-xs">
            <div className="w-3 h-3 border border-gold/40 border-t-gold rounded-full animate-spin" />
            AI is processing your diary entries...
          </div>
        </div>
      )}

      {entry.status === 'error' && (
        <p className="text-red-400/60 text-xs mt-2">{entry.error || 'Processing failed'}</p>
      )}
    </div>
  );
}

export default function PDFUpload() {
  const [entries, setEntries]   = useState<PDFEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    const data = await pdfAPI.list();
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Poll every 5s to check processing status
    pollRef.current = setInterval(() => {
      setEntries(prev => {
        if (prev.some(e => e.status === 'processing')) {
          pdfAPI.list().then(setEntries);
        }
        return prev;
      });
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleUpload = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Please upload a PDF file');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('File size must be under 20MB');
      return;
    }
    setError('');
    setUploading(true);
    try {
      await pdfAPI.upload(file);
      await load();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  if (loading) return <div className="card h-64 shimmer" />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">PDF Diary Upload</h1>
        <p className="text-white/40 text-sm mt-1">Upload your handwritten diary PDFs. Kamal AI will scan and categorize entries by customer.</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileRef.current?.click()}
        className={`
          border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
          ${dragging ? 'border-gold bg-gold/5 scale-[1.01]' : 'border-dark-50 hover:border-gold/40 hover:bg-dark-300/50'}
          ${uploading ? 'cursor-not-allowed opacity-70' : ''}
        `}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
            <p className="text-white/60">Uploading and processing...</p>
          </div>
        ) : (
          <>
            <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-colors ${dragging ? 'bg-gold' : 'bg-dark-200'}`}>
              <Upload size={24} className={dragging ? 'text-dark-500' : 'text-white/40'} />
            </div>
            <p className="text-white font-semibold mb-1">Drop your PDF diary here</p>
            <p className="text-white/40 text-sm">or click to browse · Max 20MB</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Sparkles size={12} className="text-gold" />
              <p className="text-gold/60 text-xs">AI will automatically identify customer interactions</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* How it works */}
      <div className="card">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-gold" /> How Kamal AI Processes Your Diary
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { step: '1', title: 'Upload PDF', desc: 'Upload your handwritten diary converted to PDF' },
            { step: '2', title: 'AI Extraction', desc: 'Kamal scans text and identifies customer names, dates, and interactions' },
            { step: '3', title: 'Auto-Categorize', desc: 'Entries are matched to your assigned customers automatically' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-gold text-[10px] font-bold">{step}</span>
              </div>
              <div>
                <p className="text-white text-sm font-medium">{title}</p>
                <p className="text-white/30 text-xs mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Entry history */}
      {entries.length > 0 && (
        <div>
          <h2 className="text-white font-semibold mb-3">Upload History</h2>
          <div className="space-y-3">
            {entries.map(e => <EntryCard key={e.id} entry={e} />)}
          </div>
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="card text-center py-10">
          <FileText size={32} className="text-white/10 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No PDFs uploaded yet. Start by uploading your first diary entry.</p>
        </div>
      )}
    </div>
  );
}
