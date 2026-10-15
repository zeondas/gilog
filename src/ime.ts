// 입력 칸에 들어가면 윈도우 입력기를 한글 상태로 바꿔요(사용자가 정함).
// 메일 주소 칸과 암호 칸만 영문이에요. 칸에 data-ime="en"을 붙이면 그 칸도 영문이 돼요.
import { api, inApp } from "./api";

function isTextField(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ["text", "search", "tel", "email", "url", "password", ""].includes(el.type);
}

function wantsEnglish(el: HTMLElement): boolean {
  if (el.dataset.ime === "en") return true;
  if (el instanceof HTMLInputElement) {
    if (["email", "url", "password"].includes(el.type)) return true;
    if (el.name === "email" || el.inputMode === "email") return true;
  }
  return false;
}

/** 지금 칸에 맞게 입력기를 맞춰요. 칸의 data-ime가 바뀌었을 때도 불러요. */
export function applyIme(el: Element | null = document.activeElement) {
  if (!inApp || !isTextField(el)) return;
  api.setIme(!wantsEnglish(el)).catch(() => {});
}

let installed = false;

export function installIme() {
  if (installed || !inApp) return;
  installed = true;
  document.addEventListener("focusin", (e) => applyIme(e.target as Element));
  // 다른 프로그램에 갔다가 돌아왔을 때도 커서가 있는 칸에 맞춰요.
  window.addEventListener("focus", () => applyIme());
}
