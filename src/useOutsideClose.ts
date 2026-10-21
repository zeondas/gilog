// "바깥을 누르면 닫기" 공통 부품(2026-10-21 공통 부품 세션 ✔1, docs/qa/parts.md 2-1절).
// 규칙: 누르기 시작한 곳(mousedown)이 바깥일 때만 – 안에서 눌러 끌다가 바깥에서 떼면 닫히지 않아요(CLAUDE.md "시안 두는 곳").
// 화면마다 달랐던 것(문서/창 전체, 먼저 잡기, 창 밖으로 가면 닫기, 한 박자 늦게 붙이기, 이름표로 안쪽 치기)은 옵션으로 그대로 고를 수 있어요.
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

/** 안쪽으로 칠 상자: ref 또는 그때그때 상자를 돌려주는 함수(부모 상자까지 안쪽으로 칠 때 등) */
export type Inside = RefObject<Element | null> | (() => Element | null | undefined);

export type OutsideOptions = {
  /** 안쪽으로 칠 이름표(`closest`로 봐요) – 예: ".bd-pop, [data-pick]" */
  ignore?: string;
  /** 다른 것보다 먼저 받기(capture) – 안에서 누르기를 막는(stopPropagation) 상자가 있을 때 */
  capture?: boolean;
  /** 듣는 곳: 처음 값 document */
  on?: "document" | "window";
  /** 한 박자 늦게 붙이기 – 여는 그 누르기에 바로 닫히지 않게(민원처리 떠 있는 상자) */
  defer?: boolean;
  /** 앱 창 밖으로 가면(window blur) 함께 부를 것 */
  onBlur?: () => void;
  /** Esc를 같은 자리에서 다룰 때(창 전체 keydown) */
  onEsc?: (e: KeyboardEvent) => void;
  /** Esc를 먼저 받기(capture) */
  escCapture?: boolean;
};

const toEl = (x: Inside): Element | null | undefined => (typeof x === "function" ? x() : x.current);

/** 누른 곳이 이 상자들 안인지 – 눌린 길(composedPath)로 봐서, 누르는 순간 지워지는 칸(배지 × 등)도 바르게 가려요. */
export function isInside(e: Event, ...boxes: Inside[]): boolean {
  const path = e.composedPath();
  return boxes.some((b) => {
    const el = toEl(b);
    return !!el && path.includes(el);
  });
}

/**
 * 켜져 있는 동안 바깥 누르기(mousedown)에 `onOutside`를 불러요.
 * `inside`가 비어 있으면 모든 누르기가 바깥이에요(이름표 `ignore`만으로 가릴 때).
 */
export function useOutsideClose(active: boolean, inside: Inside[], onOutside: (e: MouseEvent) => void, opt: OutsideOptions = {}) {
  const r = useRef({ inside, onOutside, opt });
  r.current = { inside, onOutside, opt };
  const { capture = false, on = "document", defer = false, escCapture = false } = opt;
  const hasBlur = !!opt.onBlur;
  const hasEsc = !!opt.onEsc;
  useEffect(() => {
    if (!active) return;
    const target: Document | Window = on === "window" ? window : document;
    const down = (ev: Event) => {
      const e = ev as MouseEvent;
      const { inside: boxes, onOutside: fn, opt: o } = r.current;
      if (isInside(e, ...boxes)) return;
      if (o.ignore && e.target instanceof Element && e.target.closest(o.ignore)) return;
      fn(e);
    };
    const blur = () => r.current.opt.onBlur?.();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") r.current.opt.onEsc?.(e);
    };
    let timer = 0;
    const add = () => target.addEventListener("mousedown", down, capture);
    if (defer) timer = window.setTimeout(add);
    else add();
    if (hasBlur) window.addEventListener("blur", blur);
    if (hasEsc) window.addEventListener("keydown", key, escCapture);
    return () => {
      window.clearTimeout(timer);
      target.removeEventListener("mousedown", down, capture);
      if (hasBlur) window.removeEventListener("blur", blur);
      if (hasEsc) window.removeEventListener("keydown", key, escCapture);
    };
  }, [active, on, capture, defer, hasBlur, hasEsc, escCapture]);
}

/** 창 바탕용: 바탕 자체를 누르기 시작했을 때만 닫기(`<div className="overlay" onMouseDown={overlayDown(close)}>`) */
export function overlayDown(close: () => void) {
  return (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) close();
  };
}
