import { useState, useEffect } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { tagDefsAPI } from '../lib/api';
import type { TagDef } from '../types';

const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#C9A84C',
  '#10b981', '#3b82f6', '#a855f7', '#ec4899',
  '#06b6d4', '#84cc16', '#6366f1', '#78716c',
];

interface TagPickerProps {
  /** Currently selected tag names */
  selected: string[];
  onChange: (tags: string[]) => void;
  /** When true shows the "+ New tag" chip for inline creation */
  isAdmin?: boolean;
  /** Optional pre-loaded defs; if omitted, component fetches them itself */
  defs?: TagDef[];
}

export default function TagPicker({ selected, onChange, isAdmin, defs: propDefs }: TagPickerProps) {
  const [defs,       setDefs]       = useState<TagDef[]>(propDefs ?? []);
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState('');
  const [newColor,   setNewColor]   = useState(COLOR_PALETTE[0]);
  const [creating,   setCreating]   = useState(false);

  useEffect(() => {
    if (propDefs) { setDefs(propDefs); return; }
    tagDefsAPI.list().then(setDefs).catch(err => console.error('[TagPicker] failed to load tag definitions', err));
  }, [propDefs]);

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter(t => t !== name)
        : [...selected, name]
    );
  };

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const def: TagDef = await tagDefsAPI.create(newName.trim(), newColor);
      setDefs(d => [...d, def]);
      onChange([...selected, def.name]);
      setNewName('');
      setShowCreate(false);
    } catch { /* non-fatal */ } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 items-center min-h-[2rem]">
      {defs.map(def => {
        const active = selected.includes(def.name);
        return (
          <button
            key={def.id}
            type="button"
            onClick={() => toggle(def.name)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border select-none"
            style={{
              borderColor: active ? def.color : `${def.color}50`,
              background:  active ? `${def.color}20` : 'transparent',
              color:       active ? def.color : `${def.color}99`,
            }}
          >
            {active && <Check size={9} />}
            {def.name}
          </button>
        );
      })}

      {/* Admin: create new tag inline */}
      {isAdmin && !showCreate && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-white/30 border border-dashed border-white/20 hover:border-white/40 hover:text-white/60 transition-all"
        >
          <Plus size={10} /> New tag
        </button>
      )}

      {isAdmin && showCreate && (
        <div className="flex items-center gap-2 bg-dark-200 rounded-xl px-3 py-2 border border-dark-50 flex-wrap">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); handleCreate(); }
              if (e.key === 'Escape') { setShowCreate(false); setNewName(''); }
            }}
            placeholder="Tag name"
            className="bg-transparent text-white text-xs outline-none w-20 placeholder:text-white/30"
          />
          {/* Colour swatches */}
          <div className="flex gap-1 flex-wrap">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className="w-4 h-4 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                style={{
                  background: c,
                  outline:       newColor === c ? `2px solid ${c}` : 'none',
                  outlineOffset: newColor === c ? '2px' : '0',
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="text-gold text-xs font-semibold disabled:opacity-40 hover:text-gold/80 transition-colors"
          >
            {creating ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewName(''); }}
            className="text-white/30 hover:text-white transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
