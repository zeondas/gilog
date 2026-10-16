// 머릿기호 규칙을 따르는 화면 조각들이에요(파일 이름은 bullets.ts와 대소문자만 다르면 윈도우에서 부딪혀 BulletParts예요). 규칙과 저장 모양은 bullets.ts에 있어요.
// - Mark: 머릿기호 하나(앱이 그려요, 윈도우 글자 □○를 쓰지 않아요)
// - BulletView: 보기 화면. 복사하면 □ ○ - 글자와 띄어쓰기로 나가요.
// - BulletEditor: 여러 줄 입력 칸(민원 내용·조치내용, 할 일 세부정보)
import { ClipboardEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BLine, isBlank, kindOf, layout, linePrefix, nextLine, textToLines, TRIGGERS, withKind } from "./bullets";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/**
 * 머릿기호 하나. 위계 단계(lv, layout으로 셈)만큼 들여쓰고, 한글 글자 높이의 정중앙에 둬요.
 * hide면 자리만 두고 기호는 그리지 않아요(빈 줄).
 */
export function Mark({ line, lv, hide }: { line: BLine; lv: number; hide?: boolean }) {
  const k = kindOf(line);
  return (
    <span className="bl-m" aria-hidden="true" style={{ marginLeft: `calc(var(--bl-indent, 6.5px) * ${lv})` }}>
      {k !== "none" && !hide && <span className={"bl-shape bl-" + k} />}
    </span>
  );
}

/** 보기 화면의 여러 줄. render로 글자 꾸미기(검색 형광 등)를 넘겨받아요. */
export function BulletView({ lines, render, className }: { lines: BLine[]; render?: (l: BLine) => ReactNode; className?: string }) {
  if (!lines.length) return null;
  const lv = layout(lines);
  return (
    <div className={"bl-list " + (className ?? "")} onCopy={copyLines}>
      {lines.map((l, i) => (
        <div key={i} className={"bl-line" + (isBlank(l) ? " bl-blank" : "")} data-bl={linePrefix(l, lv[i])}>
          <Mark line={l} lv={lv[i]} hide={isBlank(l)} />
          <span className="bl-t" style={{ fontWeight: l.b ? 700 : undefined, textDecoration: l.s ? "line-through" : undefined }}>
            {render ? render(l) : l.t}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 보기 화면에서 여러 줄을 골라 복사하면 줄마다 "  ○ " 같은 기호·들여쓰기를 붙여 줘요.
 * 한 줄 안에서만 고르면 글자 그대로예요.
 */
function copyLines(e: ClipboardEvent<HTMLDivElement>) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".bl-line")].filter((r) => range.intersectsNode(r));
  if (rows.length < 2) return;
  const out = rows.map((r) => {
    const t = r.querySelector(".bl-t");
    if (!t) return "";
    const part = document.createRange();
    part.selectNodeContents(t);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    return (r.dataset.bl ?? "") + part.toString();
  });
  e.preventDefault();
  e.clipboardData.setData("text/plain", out.join("\n"));
}

// ---------- 입력 칸 ----------

type EditorProps = {
  lines: BLine[];
  onChange: (lines: BLine[]) => void;
  /** 첫 줄이 비어 있을 때 보이는 안내 글 */
  placeholder?: string;
  /** 칸 이름 (필수 칸 검사에서 커서를 옮길 때 써요) */
  name: string;
  label: string;
  invalid?: boolean;
  /** 처음 그려질 때 커서를 둘지 */
  autoFocusEnd?: boolean;
};

/**
 * 여러 줄 입력 칸. 줄마다 머릿기호가 처음부터 보이고, 글은 그 뒤에 써져요.
 * - Enter: 막지 않고 위로 넘겨요(등록·저장은 줄을 가진 쪽이 해요). 줄바꿈 글자가 들어와도 띄어쓰기로 바꿔요.
 * - Shift+Enter, Ctrl+Enter: 새 줄 (윗줄과 같은 머릿기호)
 * - 줄 맨 앞 Backspace: 머릿기호 지우기 → 한 번 더(또는 빈 줄): 윗줄과 합치기
 * - 줄 맨 앞 "] " ") " "- ": □·●·작대기. 들여쓰기는 위계로 정해요(bullets.ts layout).
 * - 빈 줄은 묶음을 나눠요. 커서가 없는 빈 줄은 기호를 그리지 않아요.
 * - 여러 줄을 붙여 넣으면 줄마다 나눠요(앞의 □ ○ - • 는 단계로 알아봐요)
 */
export function BulletEditor({ lines, onChange, placeholder, name, label, invalid, autoFocusEnd }: EditorProps) {
  const ls = lines.length ? lines : [{ t: "" }];
  const lv = layout(ls);
  const box = useRef<HTMLDivElement>(null);
  /** 커서가 있는 줄 (빈 줄의 기호는 이 줄일 때만 보여요) */
  const [at, setAt] = useState<number | null>(null);
  /** 다음 그리기 때 커서를 둘 곳 [줄, 글자 위치] */
  const want = useRef<[number, number] | null>(null);

  const area = (i: number) => box.current?.querySelector<HTMLTextAreaElement>(`textarea[data-i="${i}"]`) ?? null;

  // 줄마다 글 길이에 맞춰 높이를 늘리고, 정해 둔 곳에 커서를 둬요.
  useLayoutEffect(() => {
    box.current?.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((el) => {
      el.style.height = "0px";
      el.style.height = el.scrollHeight + "px";
    });
    if (want.current) {
      const [i, at] = want.current;
      want.current = null;
      const el = area(i);
      if (el) {
        el.focus();
        el.setSelectionRange(at, at);
      }
    }
  });

  useEffect(() => {
    if (!autoFocusEnd) return;
    const last = ls.length - 1;
    want.current = [last, ls[last].t.length];
    const el = area(last);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function edit(next: BLine[], caret?: [number, number]) {
    if (caret) want.current = caret;
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, i: number) {
    if (isComposing(e)) return;
    const el = e.currentTarget;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const cur = ls[i];
    if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      // 새 줄. 커서 뒤의 글은 새 줄로 넘겨요.
      e.preventDefault();
      e.stopPropagation();
      const next = ls.slice();
      next[i] = { ...cur, t: cur.t.slice(0, a) };
      next.splice(i + 1, 0, nextLine(cur, cur.t.slice(b), lv[i]));
      edit(next, [i + 1, 0]);
    } else if (e.key === "Backspace" && a === 0 && b === 0) {
      if (!isBlank(cur) && kindOf(cur) !== "none") {
        // 머릿기호만 지워요. 글 시작 위치(단계)는 그대로예요.
        e.preventDefault();
        const next = ls.slice();
        next[i] = withKind(cur, "none", lv[i]);
        edit(next, [i, 0]);
      } else if (i > 0) {
        e.preventDefault();
        const prev = ls[i - 1];
        const next = ls.slice();
        next[i - 1] = { ...prev, t: prev.t + cur.t };
        next.splice(i, 1);
        edit(next, [i - 1, prev.t.length]);
      } else if (kindOf(cur) === "none") {
        // 첫 줄은 합칠 윗줄이 없으니 기호를 되살려요.
        e.preventDefault();
        const next = ls.slice();
        next[0] = withKind(cur, "ci");
        edit(next, [0, 0]);
      }
    } else if (e.key === " " && a === 1 && b === 1 && TRIGGERS[cur.t[0]]) {
      // 줄 맨 앞의 "] " ") " "- " → 머릿기호
      e.preventDefault();
      const next = ls.slice();
      next[i] = { ...withKind(cur, TRIGGERS[cur.t[0]]), t: cur.t.slice(1) };
      edit(next, [i, 0]);
    } else if (e.key === "ArrowUp" && i > 0 && a === 0 && b === 0) {
      e.preventDefault();
      want.current = [i - 1, ls[i - 1].t.length];
      area(i - 1)?.focus();
      area(i - 1)?.setSelectionRange(ls[i - 1].t.length, ls[i - 1].t.length);
    } else if (e.key === "ArrowDown" && i < ls.length - 1 && a === cur.t.length && b === a) {
      e.preventDefault();
      area(i + 1)?.focus();
      area(i + 1)?.setSelectionRange(0, 0);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>, i: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const el = e.currentTarget;
    const cur = ls[i];
    const head = cur.t.slice(0, el.selectionStart);
    const tail = cur.t.slice(el.selectionEnd);
    const got = textToLines(text);
    if (!got.length) return;
    const next = ls.slice();
    const first = got[0];
    // 첫 줄은 지금 줄에 이어 붙여요. 지금 줄이 비어 있으면 붙여 넣은 줄의 머릿기호를 따라요.
    next[i] = head ? { ...cur, t: head + first.t } : { ...first, t: first.t };
    const rest = got.slice(1).map((l) => ({ ...l }));
    if (rest.length) {
      const last = rest[rest.length - 1];
      const caret = last.t.length;
      last.t += tail;
      next.splice(i + 1, 0, ...rest);
      edit(next, [i + rest.length, caret]);
    } else {
      next[i] = { ...next[i], t: next[i].t + tail };
      edit(next, [i, head.length + first.t.length]);
    }
  }

  return (
    <div ref={box} className={"bl-ed cell-input" + (invalid ? " invalid" : "")} role="group" aria-label={label} onMouseDown={(e) => {
      // 줄 바깥 빈 곳을 누르면 마지막 줄 끝으로 가요.
      if (e.target === e.currentTarget) {
        e.preventDefault();
        const el = area(ls.length - 1);
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      }
    }}>
      {ls.map((l, i) => (
        <div key={i} className="bl-line bl-eline">
          <Mark line={l} lv={lv[i]} hide={isBlank(l) && at !== i && ls.length > 1} />
          <textarea
            data-i={i}
            name={i === 0 ? name : undefined}
            aria-label={ls.length > 1 ? `${label} ${i + 1}번째 줄` : label}
            aria-invalid={i === 0 && invalid ? true : undefined}
            rows={1}
            className="bl-ta"
            placeholder={i === 0 && ls.length === 1 ? placeholder : undefined}
            value={l.t}
            onChange={(e) => {
              const next = ls.slice();
              next[i] = { ...l, t: e.target.value.replace(/\n/g, " ") };
              onChange(next);
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            onPaste={(e) => onPaste(e, i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt((x) => (x === i ? null : x))}
          />
        </div>
      ))}
    </div>
  );
}
