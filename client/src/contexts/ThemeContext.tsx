import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

// Preset accent swatches
export const ACCENT_PRESETS = [
  // Warm
  { name: 'Gold',      main: '#C9A84C', dark: '#A8872A', light: '#DCB24F' },
  { name: 'Amber',     main: '#F59E0B', dark: '#B45309', light: '#FCD34D' },
  { name: 'Coral',     main: '#FB923C', dark: '#C2410C', light: '#FDBA74' },
  { name: 'Crimson',   main: '#F43F5E', dark: '#BE123C', light: '#FB7185' },
  { name: 'Rose',      main: '#E8617A', dark: '#C44A62', light: '#F08898' },
  // Cool
  { name: 'Violet',    main: '#A78BFA', dark: '#7C5FD6', light: '#C4B5FD' },
  { name: 'Purple',    main: '#C084FC', dark: '#9333EA', light: '#E879F9' },
  { name: 'Indigo',    main: '#818CF8', dark: '#4338CA', light: '#A5B4FC' },
  { name: 'Sky',       main: '#38BDF8', dark: '#0EA5E9', light: '#7DD3FC' },
  { name: 'Cyan',      main: '#22D3EE', dark: '#0891B2', light: '#67E8F9' },
  // Nature
  { name: 'Teal',      main: '#2DD4BF', dark: '#0F9E8C', light: '#5EE8D6' },
  { name: 'Emerald',   main: '#34D399', dark: '#059669', light: '#6EE7B7' },
  { name: 'Lime',      main: '#A3E635', dark: '#65A30D', light: '#D9F99D' },
  { name: 'Green',     main: '#4ADE80', dark: '#16A34A', light: '#86EFAC' },
  // Neutral / unique
  { name: 'Silver',    main: '#94A3B8', dark: '#64748B', light: '#CBD5E1' },
  { name: 'Blush',     main: '#FDA4AF', dark: '#E11D48', light: '#FECDD3' },
  { name: 'Peach',     main: '#FDBA74', dark: '#EA580C', light: '#FED7AA' },
  { name: 'Mint',      main: '#6EE7B7', dark: '#059669', light: '#A7F3D0' },
  { name: 'Lavender',  main: '#C4B5FD', dark: '#7C3AED', light: '#DDD6FE' },
  { name: 'Saffron',   main: '#FB923C', dark: '#9A3412', light: '#FFEDD5' },
] as const;

export type AccentPreset = typeof ACCENT_PRESETS[number];

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  isLight: boolean;
  accent: AccentPreset;
  setAccent: (preset: AccentPreset) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  isLight: false,
  accent: ACCENT_PRESETS[0],
  setAccent: () => {},
});

/** Convert a hex colour (#RRGGBB) to a space-separated "R G B" triplet. */
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyAccent(preset: AccentPreset) {
  const root = document.documentElement;
  // Hex values — used by direct var(--accent) references in index.css
  root.style.setProperty('--accent',       preset.main);
  root.style.setProperty('--accent-dark',  preset.dark);
  root.style.setProperty('--accent-light', preset.light);
  // Legacy gold vars for any var(--gold) usage
  root.style.setProperty('--gold',         preset.main);
  root.style.setProperty('--gold-dark',    preset.dark);
  root.style.setProperty('--gold-light',   preset.light);
  // RGB triplets — required so Tailwind's opacity modifiers work dynamically:
  // bg-gold/10 → rgb(var(--accent-rgb) / 0.1) which updates with every accent change.
  root.style.setProperty('--accent-rgb',       hexToRgbTriplet(preset.main));
  root.style.setProperty('--accent-rgb-dark',  hexToRgbTriplet(preset.dark));
  root.style.setProperty('--accent-rgb-light', hexToRgbTriplet(preset.light));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('kk_theme') as Theme) || 'dark'
  );

  const [accent, setAccentState] = useState<AccentPreset>(() => {
    try {
      const saved = localStorage.getItem('kk_accent');
      if (saved) return ACCENT_PRESETS.find(p => p.name === saved) ?? ACCENT_PRESETS[0];
    } catch {}
    return ACCENT_PRESETS[0];
  });

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'light') html.classList.add('light');
    else html.classList.remove('light');
    localStorage.setItem('kk_theme', theme);
  }, [theme]);

  useEffect(() => { applyAccent(accent); }, [accent]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  const setAccent = (preset: AccentPreset) => {
    setAccentState(preset);
    localStorage.setItem('kk_accent', preset.name);
    applyAccent(preset);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle, isLight: theme === 'light', accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
