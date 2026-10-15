// 한글 기본 규칙 (사용자가 정함): 입력 칸의 기본은 한글이에요. 메일·암호 칸과 data-ime="en" 칸만 영문이에요.
//
// 0.6.1까지는 윈도우 입력기에 "한글로 바꿔"를 보냈는데, 앱 화면(WebView2)이 그것을 놓칠 때가 있어
// 다른 앱에서 돌아오면 영문이 써졌어요(사용자 신고 두 번). 그래서 0.6.2부터는 두 겹으로 해요.
// 1) 칸에 들어가거나 앱으로 돌아오면 지금처럼 입력기를 한글로 바꿔 달라고 해요(ime.rs, 되면 그것으로 끝).
// 2) 그래도 한글 칸에 영문 글자 키가 들어오면(입력기가 영문이라는 뜻) 그 키를 막고,
//    앱이 두벌식으로 직접 한글을 조립해 넣어요(hangul.ts). 입력기 상태와 상관없이 한글이 들어가요.
//    입력기가 한글이면 키가 "조합 중"(229)으로 들어오니 앱은 끼어들지 않아요.
//    한/영 키로 일부러 영문을 고르면 그 칸에서는 그대로 영문이에요(칸을 떠나면 다시 한글).
import { api, inApp } from "./api";
import { Composer, jamoOfKey } from "./hangul";

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

/** 키로 짐작한 입력기 상태. 조합 중(229) 키가 오면 한글, 영문 글자가 그대로 오면 영문이에요. */
let seen: "ko" | "en" | "?" = "?";
/** 이 칸에서 사용자가 한/영 키로 일부러 영문을 골랐는지 */
let englishByChoice = false;

/** 지금 조립 중인 글자 묶음과 그 칸 */
let comp: Composer | null = null;
let compEl: HTMLElement | null = null;

function endCompose() {
  comp = null;
  compEl = null;
}

/** 지금 칸에 맞게 입력기를 맞춰요. 칸의 data-ime가 바뀌었을 때도 불러요. */
export function applyIme(el: Element | null = document.activeElement) {
  if (!inApp || !isTextField(el)) return;
  englishByChoice = false;
  endCompose();
  api.setIme(!wantsEnglish(el)).catch(() => {});
}

/** 한/영 키(또는 그 자리의 오른쪽 Alt)인지 */
const isLangKey = (e: KeyboardEvent) => e.key === "HangulMode" || e.code === "Lang1" || e.code === "AltRight";

/** 커서 바로 앞 n글자가 want인지 (조립하던 글자가 그 자리에 그대로 있는지) */
function before(el: HTMLElement, n: number): string | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const a = el.selectionStart ?? 0;
    if (a !== el.selectionEnd || a < n) return null;
    return el.value.slice(a - n, a);
  }
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || r.startOffset < n) return null;
  return (node.textContent ?? "").slice(r.startOffset - n, r.startOffset);
}

/** 커서 앞 n글자를 text로 바꿔요. 화면 코드(React)가 보통 입력처럼 받도록 브라우저의 글자 넣기를 써요. */
function replaceBefore(el: HTMLElement, n: number, text: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const a = el.selectionStart ?? 0;
    el.setSelectionRange(a - n, a);
  } else if (n > 0) {
    const sel = window.getSelection();
    const r = sel?.getRangeAt(0);
    if (sel && r) {
      const range = document.createRange();
      range.setStart(r.startContainer, r.startOffset - n);
      range.setEnd(r.startContainer, r.startOffset);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  if (text) document.execCommand("insertText", false, text);
  else if (n > 0) document.execCommand("delete", false);
}

function onKeyDown(e: KeyboardEvent) {
  const el = e.target as Element | null;
  if (!isTextField(el) || wantsEnglish(el)) {
    endCompose();
    return;
  }
  if (isLangKey(e)) {
    // 한/영을 눌렀어요. 한글이던 것을 영문으로 바꿨으면 일부러 고른 것이에요.
    englishByChoice = seen === "ko" ? true : seen === "en" ? false : !englishByChoice;
    seen = seen === "ko" ? "en" : seen === "en" ? "ko" : "?";
    endCompose();
    return;
  }
  if (e.isComposing || e.keyCode === 229) {
    // 입력기가 한글로 조합하고 있어요. 앱은 끼어들지 않아요.
    seen = "ko";
    endCompose();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) {
    endCompose();
    return;
  }

  const jamo = jamoOfKey(e.code, e.shiftKey);
  const isLetter = !!jamo && /^[a-zA-Z]$/.test(e.key);
  if (isLetter) seen = "en";

  // 조립하던 글자를 Backspace로 하나씩 지워요(입력기처럼 마지막 글자 안에서).
  if (e.key === "Backspace" && comp && compEl === el) {
    const prev = comp.out;
    if (prev && before(el, prev.length) === prev) {
      e.preventDefault();
      e.stopPropagation();
      replaceBefore(el, prev.length, comp.back());
      if (!comp.jamos.length) endCompose();
      return;
    }
    endCompose();
    return;
  }

  if (!isLetter || englishByChoice) {
    // 글자 키가 아니면(띄어쓰기, 숫자, Enter, 화살표 …) 조립이 끝나요.
    if (e.key !== "Shift" && e.key !== "CapsLock") endCompose();
    return;
  }

  // 영문 상태로 한글 칸에 글자가 들어오려 해요 → 막고 직접 조립해요.
  e.preventDefault();
  e.stopPropagation();
  if (!comp || compEl !== el || (comp.out && before(el, comp.out.length) !== comp.out)) {
    // 새로 시작하거나, 커서가 옮겨졌으면 새 묶음이에요. 입력기도 한글로 다시 맞춰 달라고 해요.
    if (!comp) api.setIme(true).catch(() => {});
    comp = new Composer();
    compEl = el;
  }
  const prevLen = comp.out.length;
  replaceBefore(el, prevLen, comp.add(jamo));
}

let installed = false;

export function installIme() {
  if (installed || !inApp) return;
  installed = true;
  document.addEventListener("focusin", (e) => applyIme(e.target as Element));
  // 다른 프로그램에 갔다가 돌아왔을 때도 커서가 있는 칸에 맞춰요.
  window.addEventListener("focus", () => applyIme());
  document.addEventListener("mousedown", endCompose, true);
  // 다른 화면 코드보다 먼저 키를 봐야 해서 잡기 단계(capture)에 걸어요.
  window.addEventListener("keydown", onKeyDown, true);
}

/** 브라우저 미리 보기에서 시험할 때 쓰는 문(앱 밖에서는 installIme가 아무것도 안 해요) */
export function installImeForTest() {
  if (installed) return;
  installed = true;
  document.addEventListener("focusin", (e) => applyIme(e.target as Element));
  document.addEventListener("mousedown", endCompose, true);
  window.addEventListener("keydown", onKeyDown, true);
}
