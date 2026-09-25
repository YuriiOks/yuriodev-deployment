/*
 * Pre-paint theme. Loaded synchronously from <head>, before the stylesheet, so
 * the first frame already has the right theme and no dark/light flash shows.
 * It is a same-origin file (not an inline script) so a strict CSP needs no hash.
 * Keep the key and colours in sync with src/context/themeStore.ts.
 */
(function () {
  var root = document.documentElement;
  var theme = null;
  try {
    theme = window.localStorage.getItem('theme');
  } catch (e) {
    // Site data blocked: fall back to the system preference.
  }
  if (theme !== 'light' && theme !== 'dark') {
    try {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      theme = 'dark';
    }
  }
  root.setAttribute('data-theme', theme);
  var color = theme === 'light' ? '#f8fafc' : '#0a0f1c';
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', color);
})();
