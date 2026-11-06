// Sets the theme before first paint, so there is never a flash of the wrong
// theme (Phase 6b). Loaded synchronously from <head> as an external file (not
// inline), so a strict Content-Security-Policy needs no hash for it.
// Stored choice: localStorage "ogs.theme" = "light" | "dark" | "system".
(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('ogs.theme') || 'system';
  } catch {
    // Storage blocked: follow the system.
  }
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
