/* ════════════════════ boot ════════════════════ */
setYaw(S.yaw);
document.title = `${ATLAS.meta.repo} · code atlas`;
renderStats();
renderViews();
renderServices();
renderLegend();
resize();
setView(VIEWS[0]?.id ?? "structure");
syncControls();
requestAnimationFrame(frame);
