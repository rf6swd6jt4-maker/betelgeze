/** Early, document-local branding. Never inherited by workspace iframe panels. */
export const appStartupBootstrap = String.raw`(() => {
  const root = document.documentElement;
  const path = window.location.pathname;
  const client = /^\/(?:client-portal|onboarding)(?:\/|$)/.test(path) || /^\/[a-f0-9]{64}\/?$/i.test(path);
  const frame = window.self !== window.top;
  const appHost = /^(?:app\.betelgeze\.com|dashboard\.betelgeze\.com|localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  root.dataset.appStartup = client ? "client" : frame ? "panel" : appHost ? "launch" : "none";
  if (client) root.dataset.clientPortalStartup = "true";
  if (root.dataset.appStartup !== "launch") return;
  function finish() {
    const content = Array.from(document.querySelectorAll("main, form, [data-workspace-shell-root]"));
    if (!content.some(node => !node.closest("[hidden]"))) return false;
    root.dataset.appStartup = "complete";
    return true;
  }
  if (finish()) return;
  const observer = new MutationObserver(() => { if (finish()) observer.disconnect(); });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();`

export const appStartupStyles = `
html, body { background-color: #171717; }
[data-app-startup-screen] { display: none !important; }
html[data-app-startup="launch"], html[data-app-startup="launch"] body {
  background-image: url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cpath fill=%22white%22 d=%22M32 4 60 32 32 60 4 32Z%22/%3E%3C/svg%3E");
  background-position: center; background-repeat: no-repeat; background-size: 64px 64px;
}
html[data-app-startup="launch"] [data-app-startup-screen] { display: grid !important; }
html[data-app-startup="client"], html[data-app-startup="client"] body { background-color: #F8F7F3; }
`
