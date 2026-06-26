// Inline, blocking script placed in <head> to set the theme class before
// first paint — avoids flash-of-wrong-theme and the next-themes <script> warning.
const code = `
(function() {
  try {
    var s = localStorage.getItem('theme');
    var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = s ? s === 'dark' : true; // default dark
    if (s === 'system') dark = sysDark;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: code }} suppressHydrationWarning />;
}
