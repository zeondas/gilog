// 업무일지 말 줄 키 – talkAction(엔터규칙 "업무일지 말 줄")·insertBreak·lineEdge. NewCard·EditCard가 불러요.
import { KeyboardEvent } from "react";
import { keyAction } from "../../keys";

/**
 * 말 줄의 키 (엔터규칙 "업무일지 말 줄", keys.ts). Enter 다음 말(사람 교대) · Shift+Enter 같은 사람이 이어서
 * · 왼쪽 Alt+Enter 한 말 안 줄 바꿈 · Tab 등록 · Shift+Tab 앞 칸 · Esc 취소. Ctrl+Enter는 쓰지 않아요.
 * 한글 조합 중 Tab·두 번 들어온 Tab은 keyAction이 다뤄요.
 */
export function talkAction(e: KeyboardEvent): "next" | "same" | "br" | "submit" | "prev" | "cancel" | null {
  switch (keyAction(e, "talk")) {
    case "talk.next":
      return "next";
    case "talk.same":
      return "same";
    case "talk.br":
      return "br";
    case "common.next":
      return "submit";
    case "common.prev":
      return "prev";
    case "common.cancel":
      return "cancel";
    default:
      return null;
  }
}

/** 말 줄 안 줄 바꿈: 커서 자리에 줄바꿈 글자를 넣어요(되돌리기도 돼요). */
export function insertBreak(el: HTMLTextAreaElement) {
  if (!document.execCommand("insertText", false, "\n")) el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
}

/** 위·아래 화살표로 말 줄을 옮길지 (여러 줄인 말은 맨 윗줄·맨 아랫줄에서만) */
export function lineEdge(el: HTMLTextAreaElement, up: boolean) {
  const v = el.value;
  return up ? !v.slice(0, el.selectionStart).includes("\n") : !v.slice(el.selectionEnd).includes("\n");
}
