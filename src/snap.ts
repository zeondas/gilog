/**
 * 가운데 뜨는 창(.overlay 안의 창)이 반 픽셀에 걸치면 글자가 흐리고 1px씩 어긋나 보여요.
 * 창 위쪽의 소수 부분만큼 위로 옮겨 정수 픽셀에 놓아요(글자 가운데 맞춤 7번, tools/align/snap.js).
 * 뒤를 흐리게 한 뒤로는 translate로 옮기면 창 전체가 다시 그려지며 흐려져서, 자리(top)로 옮겨요.
 * 창이 새로 뜨거나 크기가 바뀔 때마다 다시 맞춰요.
 */
function snapAll() {
  document.querySelectorAll<HTMLElement>(".overlay > *").forEach((d) => {
    d.style.position = "relative";
    d.style.top = "";
    const top = d.getBoundingClientRect().top;
    const f = top - Math.floor(top);
    if (f > 0.01) d.style.top = `${-f}px`;
  });
}

export function installSnap() {
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      snapAll();
    });
  };
  // 창 안 내용이 바뀌어 높이가 달라져도 다시 맞춰요(예: 묻는 띠가 열릴 때).
  new MutationObserver((list) => {
    if (document.querySelector(".overlay") || list.some((m) => [...m.removedNodes].some((n) => n instanceof Element && n.classList.contains("overlay")))) later();
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", later);
}
