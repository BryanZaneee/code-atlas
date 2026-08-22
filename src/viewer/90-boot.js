/* ═══ boot ═══ */
/* A plain top-level sequence. The design this was ported from wrapped the same
   body in `window.AtlasBoot` so a Claude Design component could call it after
   its own mount; nothing calls this from outside, and the re-entry guard that
   went with it guarded against a lifecycle this file no longer has. */
S.theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
applyTheme(S.theme);
document.documentElement.setAttribute("data-theme", S.theme);
document.title = `${ATLAS.meta.repo} · code atlas`;

$("#bTheme").textContent = S.theme === "dark" ? "◑ LIGHT" : "◐ DARK";

reqLoad();
loadNotes();
setYaw(S.yaw);
renderStats();
renderViews();
renderServices();
renderPalette();
renderLegend();
resize();
initInteraction();
setView(VIEWS[0]?.id ?? "structure");
fitView(true);
syncControls();
srcInit();
initOnboard();
startIntro();
requestAnimationFrame(frame);
