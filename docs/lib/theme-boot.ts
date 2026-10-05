/** Runs before first paint so the handbook is not white while next-themes hydrates. */
export const HANDBOOK_THEME_BOOT = `(function(){
  try {
    var q = new URLSearchParams(location.search).get('theme');
    var stored = localStorage.getItem('theme');
    var theme = (q === 'dark' || q === 'light') ? q
      : (stored === 'dark' || stored === 'light') ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (q === theme) localStorage.setItem('theme', theme);
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    root.style.backgroundColor = theme === 'dark' ? '#171717' : '#ffffff';
  } catch (e) {}
})();`
