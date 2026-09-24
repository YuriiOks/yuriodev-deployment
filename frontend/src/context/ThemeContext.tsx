import React, { useEffect, useState } from 'react';
import { ThemeContext, type Theme } from './theme-context';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) return savedTheme;

    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }

    // Default to dark
    return 'dark';
  });

  useEffect(() => {
    // Apply theme to document root
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'dark' ? 'light' : 'dark';

      // Terminal-style console output (matching original HTML)
      console.log(`%c$ ./set_theme --mode=${newTheme}`, 'color: #FFC107; font-family: "Fira Code", monospace; font-weight: 600;');
      console.log(`%c✓ Theme switched to: ${newTheme} mode`, 'color: #00ff88; font-family: "Fira Code", monospace;');
      console.log(`%c✓ Interface colors updated`, 'color: #00ff88; font-family: "Fira Code", monospace;');
      console.log(`%c✓ Neural network visualization adjusted`, 'color: #00ff88; font-family: "Fira Code", monospace;');

      return newTheme;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
