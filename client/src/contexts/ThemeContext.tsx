import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

// Preset accent swatches
export const ACCENT_PRESETS = [
  { name: 'Gold',    main: '#C9A84C', dark: '#A8872A', light: '#DCB24F' },
  { name: 'Rose',    main: '#E8617A', dark: '#C44A62', light: '#F08898' },
  { name: 'Teal',    main: '#2DD4BF', dark: '#0F9E8C', light: '#5EE8D6' },
  { name: 'Violet',  main: '#A78BFA', dark: '#7C5FD6', light: '#C4B5FD' },
  { name: 'Coral',   main: '#FB923C', dark: '#D97706', light: '#FDBA74' },
  { name: 'Sky',     main: '#38BDF8', dark: '#0EA5E9', light: '#7DD3FC' },
  { name: 'Lime',    main: '#A3E635', dark: '#65A30D', light: '#D9F99D' },
  { name: 'Crimson', main: '#F43F5E', dark: '#BE123C', light: '#FB7185' },
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

function applyAccent(preset: AccentPreset) {
  const r = document.documentElement;
  r.style.setProperty('--accent',       preset.main);
  r.style.setProperty('--accent-dark',  preset.dark);
  r.style.setProperty('--accent-light', preset.light);
  // Also update legacy gold vars so any hardcoded var(--gold) usage follows
  r.style.setProperty('--gold',         preset.main);
  r.style.setProperty('--gold-dark',    preset.dark);
  r.style.setProperty('--gold-light',   preset.light);
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
