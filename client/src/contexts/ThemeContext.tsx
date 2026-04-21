import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  isLight: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('kk_theme') as Theme) || 'dark';
  });

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'light') {
      html.classList.add('light');
    } else {
      html.classList.remove('light');
    }
    localStorage.setItem('kk_theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggle, isLight: theme === 'light' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
