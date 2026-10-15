// 초성을 치는 칸(업무일지 구분·상대, 업무연락처 검색)에서 한글 입력기가 자음을 묶어 버리는 것을 막아요.
//
// - 겹자음: ㄱ+ㅅ → ㄳ 처럼 묶인 것은 늘 풀어요(journal.ts의 splitJamo).
// - 된소리: 입력기에 따라 ㅅ을 두 번 치면 ㅆ이 되는데, 한국 사람 이름 초성에는 된소리가 거의 없어요.
//   그래서 Shift 없이 같은 자음을 두 번 쳐서 생긴 ㄲ·ㄸ·ㅃ·ㅆ·ㅉ은 ㄱㄱ·ㄷㄷ·ㅂㅂ·ㅅㅅ·ㅈㅈ으로 풀어요.
//   Shift+자음으로 일부러 친 된소리는 그대로 둬요(사용자가 정함).
import { ChangeEvent, CompositionEvent, KeyboardEvent, useRef } from "react";
import { splitJamo } from "./journal";

/** 키 자리(code) → 그 키의 된소리 */
const DOUBLE_KEY: Record<string, string> = { KeyR: "ㄲ", KeyE: "ㄸ", KeyQ: "ㅃ", KeyT: "ㅆ", KeyW: "ㅉ" };
const PLAIN: Record<string, string> = { ㄲ: "ㄱㄱ", ㄸ: "ㄷㄷ", ㅃ: "ㅂㅂ", ㅆ: "ㅅㅅ", ㅉ: "ㅈㅈ" };

const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length;

/**
 * 칸에 붙여 쓰는 도우미. 칸에 onKeyDown·onChange·onCompositionEnd를 이것으로 걸어요.
 * set에는 고친 값이 들어가요. 조합 중에는 친 그대로 두고, 조합이 끝나면 고쳐요.
 */
export function useJamoGuard(set: (v: string) => void) {
  /** 된소리마다 마지막으로 그 키를 칠 때 Shift를 눌렀는지 */
  const shifted = useRef<Record<string, boolean>>({});
  /** 마지막으로 고쳐서 넣은 값(조합 중인 글자는 빼고) */
  const base = useRef("");
  /** 조합 중 마지막으로 본 값과, 된소리가 처음 보였을 때의 Shift 상태 */
  const raw = useRef("");
  const seen = useRef<Record<string, boolean>>({});

  function fix(next: string): string {
    let v = splitJamo(next);
    for (const d of Object.keys(PLAIN)) {
      // 새로 생긴 된소리이고, 그 키를 Shift 없이 쳤으면 두 자음으로 풀어요(가장 뒤의 것 하나).
      const shift = seen.current[d] ?? shifted.current[d];
      if (count(v, d) > count(base.current, d) && shift === false) {
        const at = v.lastIndexOf(d);
        v = v.slice(0, at) + PLAIN[d] + v.slice(at + d.length);
      }
    }
    base.current = v;
    raw.current = v;
    seen.current = {};
    return v;
  }

  return {
    onKeyDown(e: KeyboardEvent) {
      const d = DOUBLE_KEY[e.nativeEvent.code];
      if (d) shifted.current[d] = e.shiftKey;
    },
    onChange(e: ChangeEvent<HTMLInputElement>) {
      const v = e.target.value;
      if ((e.nativeEvent as InputEvent).isComposing) {
        // 된소리가 새로 보이는 순간의 Shift 상태를 기억해요(다음 키를 치면 바뀌니까요).
        for (const d of Object.keys(PLAIN)) if (count(v, d) > count(raw.current, d) && !(d in seen.current)) seen.current[d] = !!shifted.current[d];
        raw.current = v;
        set(v);
      } else set(fix(v));
    },
    onCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
      set(fix(e.currentTarget.value));
    },
    /** 칸을 밖에서 바꿨을 때(비우기, 목록에서 고르기) 기준 값을 맞춰요. */
    sync(v: string) {
      base.current = v;
      raw.current = v;
    },
    /** 칸 값이 밖에서 바뀌었으면(부모가 비우거나 채움) 기준을 따라가요. 그리는 중에 불러도 돼요. */
    follow(v: string) {
      if (v !== raw.current && v !== base.current) {
        base.current = v;
        raw.current = v;
      }
    },
  };
}
