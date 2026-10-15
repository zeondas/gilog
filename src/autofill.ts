// 윈도우(WebView2) 자동입력 정보가 칸 아래에 뜨지 않게 해요(사용자가 정함).
// 앱 설정(tauri.conf.json의 generalAutofillEnabled: false)으로 한 번 끄고,
// 여기서 모든 입력 칸에 autocomplete="off"를 붙여 한 번 더 막아요. 나중에 생기는 칸에도 저절로 붙어요.

function mark(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((el) => {
    if (el.getAttribute("autocomplete") !== "off") el.setAttribute("autocomplete", "off");
  });
}

let installed = false;

export function installNoAutofill() {
  if (installed) return;
  installed = true;
  mark(document);
  new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) n.setAttribute("autocomplete", "off");
        else if (n instanceof Element) mark(n);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
