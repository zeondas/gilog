// 두벌식 한글 조립기예요. 입력기가 영문 상태여도 한글 칸에서는 앱이 직접 한글을 만들어 넣으려고 써요(0.6.2).
// 윈도우 입력기와 같은 규칙: 겹받침(ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ), 겹모음(ㅘ ㅙ ㅚ ㅝ ㅞ ㅟ ㅢ),
// 받침이 다음 글자 첫소리로 넘어가기(갂+ㅏ → 각가, 닭+ㅏ → 달가), 초성만 이어 치기(ㅂㅇㅊ)도 그대로예요.

/** 영문 자판 글자 → 두벌식 자모 (Shift는 대문자 칸) */
const KEY: Record<string, string> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
  Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
};

/** 키 자리(KeyA…)와 Shift로 자모를 찾아요. 한글 자판 키가 아니면 null이에요. */
export function jamoOfKey(code: string, shift: boolean): string | null {
  const m = /^Key([A-Z])$/.exec(code);
  if (!m) return null;
  const low = m[1].toLowerCase();
  return (shift && KEY[m[1]]) || KEY[low] || null;
}

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

const isVowel = (j: string) => JUNG.includes(j);

const V2: Record<string, string> = { ㅗㅏ: "ㅘ", ㅗㅐ: "ㅙ", ㅗㅣ: "ㅚ", ㅜㅓ: "ㅝ", ㅜㅔ: "ㅞ", ㅜㅣ: "ㅟ", ㅡㅣ: "ㅢ" };
const C2: Record<string, string> = { ㄱㅅ: "ㄳ", ㄴㅈ: "ㄵ", ㄴㅎ: "ㄶ", ㄹㄱ: "ㄺ", ㄹㅁ: "ㄻ", ㄹㅂ: "ㄼ", ㄹㅅ: "ㄽ", ㄹㅌ: "ㄾ", ㄹㅍ: "ㄿ", ㄹㅎ: "ㅀ", ㅂㅅ: "ㅄ" };
/** 겹받침 → [남는 받침, 넘어가는 첫소리] */
const SPLIT: Record<string, [string, string]> = Object.fromEntries(Object.entries(C2).map(([k, v]) => [v, [k[0], k[1]]]));

function syllable(cho: string, jung: string, jong: string): string {
  if (cho && jung) return String.fromCharCode(0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong));
  return cho + jung + jong;
}

/** 자모 줄을 한글로 조립해요. ["ㄷ","ㅏ","ㄹ","ㄱ","ㅏ"] → "달가" */
export function assemble(jamos: string[]): string {
  let out = "";
  let cho = "";
  let jung = "";
  let jong = "";
  const flush = () => {
    out += syllable(cho, jung, jong);
    cho = jung = jong = "";
  };
  for (const j of jamos) {
    if (isVowel(j)) {
      if (jong) {
        // 받침이 다음 글자 첫소리로 넘어가요(겹받침은 뒤 자음만).
        const sp = SPLIT[jong];
        const carry = sp ? sp[1] : jong;
        jong = sp ? sp[0] : "";
        flush();
        cho = carry;
        jung = j;
      } else if (cho && !jung) {
        jung = j;
      } else if (jung && V2[jung + j]) {
        jung = V2[jung + j];
      } else {
        flush();
        jung = j;
      }
    } else {
      if (cho && jung && !jong && JONG.includes(j)) {
        jong = j;
      } else if (jong && C2[jong + j]) {
        jong = C2[jong + j];
      } else {
        flush();
        cho = j;
      }
    }
  }
  flush();
  return out;
}

/**
 * 조립 중인 글자 묶음 하나. 자모를 하나 더하거나 지우면 바뀐 글자와 그 길이를 알려 줘요.
 * 묶음은 마지막 음절만 다시 조립하면 되도록 짧게 유지해요(앞 글자가 끝나면 잘라 내요).
 */
export class Composer {
  jamos: string[] = [];
  out = "";

  /** 자모를 더해요. 칸에 있던 this.out(더하기 전) 자리를 돌려준 글자로 바꾸면 돼요. */
  add(j: string): string {
    this.jamos.push(j);
    const full = assemble(this.jamos);
    this.out = full;
    this.trim();
    return full;
  }

  /**
   * 마지막 자모 하나를 지워요(Backspace). 윈도우 입력기처럼 마지막 글자 안에서만 지워요("세요" → "세ㅇ").
   * 칸에 있던 this.out 자리를 돌려준 글자로 바꾸면 돼요. 묶음이 비면 조립이 끝난 것이에요.
   */
  back(): string {
    const n = this.jamos.length;
    // 마지막 한 글자를 만드는 자모의 시작 자리를 찾아요.
    let k = n - 1;
    for (let i = 0; i < n; i++) {
      const tail = assemble(this.jamos.slice(i));
      if (tail.length === 1 && assemble(this.jamos.slice(0, i)) + tail === this.out) {
        k = i;
        break;
      }
    }
    const head = assemble(this.jamos.slice(0, k));
    const tail = this.jamos.slice(k, n - 1);
    this.jamos = tail;
    this.out = assemble(tail);
    return head + this.out;
  }

  /**
   * 앞 글자가 더는 바뀔 수 없으면 묶음에서 빼요. 마지막 음절 바로 앞까지는 확정이에요
   * (단, 마지막 음절이 받침 없이 첫소리+모음만 있으면 앞 글자의 받침이 넘어왔을 수 있어 둘 다 남겨요).
   */
  private trim() {
    if (this.out.length <= 2) return;
    // 마지막 두 글자만 남기고, 그 두 글자를 만드는 자모만 남겨요.
    for (let k = 1; k < this.jamos.length; k++) {
      const rest = this.jamos.slice(k);
      const a = assemble(rest);
      if (a.length <= 2 && this.out.endsWith(a) && assemble(this.jamos.slice(0, k)) + a === this.out) {
        this.jamos = rest;
        this.out = a;
        return;
      }
    }
  }
}
