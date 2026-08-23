/* ═══ onboarding ═══ */
const OB_KEY = "codeAtlasDemo:onboarded";
function initOnboard() {
  const card = $("#onboard");
  if (!card) return;
  let seen = false;
  try { seen = !!sessionStorage.getItem(OB_KEY); } catch { /* a hardened browser; show the card rather than assume it was read */ }
  if (seen) { card.hidden = true; return; }
  card.hidden = false;
  const dismiss = () => {
    card.classList.add("bye");
    try { sessionStorage.setItem(OB_KEY, "1"); } catch { /* a hardened browser; the card returns next load */ }
    setTimeout(() => { card.hidden = true; }, 260);
  };
  $("#obGo").onclick = dismiss;
  cv.addEventListener("mousedown", dismiss, { once: true });
}
