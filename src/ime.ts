// 입력 칸에 들어가면 윈도우 입력기를 한글 상태로 바꿔요(사용자가 정함: 한글 기본 규칙).
// 메일 주소 칸과 암호 칸만 영문이에요. 칸에 data-ime="en"을 붙이면 그 칸도 영문이 돼요.
//
// 다른 앱에서 돌아오면 윈도우가 예전 상태(영문)를 되살릴 때가 있어요. 그래서 두 겹으로 막아요.
// 1) 저장 쪽(ime.rs)이 giLog 창이 실제로 앞에 온 것을 확인하고 몇 번 더 맞춰요.
// 2) 칸에 들어오거나 앱으로 돌아온 뒤 첫 글자가 영문으로 들어오려 하면, 그 글자를 막고
//    한글로 바꾼 뒤 같은 키를 다시 보내 한글 자모로 들어가게 해요.
//    사용자가 한/영 키로 일부러 영문을 고르면 그 칸에서는 더 막지 않아요.
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

/** 첫 글자를 지켜보는 중인지. 칸에 들어오거나 앱으로 돌아오면 켜지고, 글자 하나를 받으면 꺼져요. */
let armed = false;

/** 지금 칸에 맞게 입력기를 맞춰요. 칸의 data-ime가 바뀌었을 때도 불러요. */
export function applyIme(el: Element | null = document.activeElement) {
  if (!inApp || !isTextField(el)) return;
  const korean = !wantsEnglish(el);
  armed = korean;
  api.setIme(korean).catch(() => {});
}

/** 한/영 키(또는 그 자리의 오른쪽 Alt)인지 */
const isLangKey = (e: KeyboardEvent) => e.key === "HangulMode" || e.code === "Lang1" || e.code === "AltRight";

function onKeyDown(e: KeyboardEvent) {
  if (!armed) return;
  const el = e.target as Element | null;
  if (!isTextField(el) || wantsEnglish(el)) {
    armed = false;
    return;
  }
  if (isLangKey(e)) {
    // 일부러 한/영을 바꿨으면 그대로 둬요.
    armed = false;
    return;
  }
  if (e.isComposing || e.keyCode === 229) {
    // 이미 한글로 들어오고 있어요.
    armed = false;
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m && /^[a-zA-Z]$/.test(e.key)) {
    // 영문 상태로 첫 글자가 들어오려 해요 → 막고, 한글로 바꿔 같은 키를 다시 보내요.
    e.preventDefault();
    e.stopPropagation();
    armed = false;
    api.imeRetype(m[1].charCodeAt(0)).catch(() => {});
  }
}

let installed = false;

export function installIme() {
  if (installed || !inApp) return;
  installed = true;
  document.addEventListener("focusin", (e) => applyIme(e.target as Element));
  // 다른 프로그램에 갔다가 돌아왔을 때도 커서가 있는 칸에 맞춰요.
  window.addEventListener("focus", () => applyIme());
  // 다른 화면 코드보다 먼저 첫 글자를 봐야 해서 잡기 단계(capture)에 걸어요.
  window.addEventListener("keydown", onKeyDown, true);
}
