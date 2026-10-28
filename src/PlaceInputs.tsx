// 민원대장의 위치 칸이에요(법정동 기준, 사용자가 정함 2026-10-16).
// - 위치 칸: 맨 앞에 법정리·동, 이어서 지번. 리·동을 고르면 지역(읍면동)이 자동으로 들어가요.
// - 지역 칸은 직접 치지 않고 위치에서만 채워요(2026-10-16 사용자 지시). 파주 목록에 없는 위치면 지역은 비워요.
// 겹치면(2안): 첫 후보가 골라진 목록이 떠요. ↑↓로 바꾸고 Tab(또는 Enter)으로 확정해요.
//   위치 칸은 "봉일천리 "까지 채운 뒤 커서가 남아 지번을 이어 써요.
// 도로명주소(2026-10-18 사용자): 칸을 떠날 때 파주시 도로명주소면 "리·동 지번"으로 바꾸고 지역도 채워요.
//   번호가 표에 없으면 가까운 번호 후보(Tab 확정 · Esc 친 그대로), 법정동이 행정동 여럿에 걸치면 지역 고르기.
//   바꾸기 전 글은 onRoad로 넘겨 마우스를 올리면 보여요(title). 칸에 다시 치면 지워요.
// 웹 먼저(2026-10-21 사용자 2안, addressWeb.ts): 치다 멈추면(0.3초) 웹에 묻고, 내장 표 답은 바로 받아 둬요.
//   웹 답이 오면 그것을 믿어요 – 칸을 이미 떠났어도(내장 답으로 바꿔 둔 그대로면) 웹 답으로 다시 바꿔요.
//   후보 목록에는 출처 배지(웹·내장)가 붙어요.
import { KeyboardEvent, Ref, useEffect, useLayoutEffect, useRef, useState } from "react";
import { areaFor, looksRoad, RoadHit, RoadLookup } from "./address";
import { api } from "./api";
import { Src, webLookup } from "./addressWeb";
import { useJamoGuard } from "./koInput";
import { emdsOf, findNames, Place, PLACES, spacePlace, splitPlace } from "./paju";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** 목록 위·아래 키를 공통으로 처리해요. 처리했으면 true예요. */
function moveKey(e: KeyboardEvent, n: number, hi: number, setHi: (i: number) => void) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHi((hi + 1) % n);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    setHi(hi <= 0 ? n - 1 : hi - 1);
    return true;
  }
  return false;
}

// ---------- 위치 ----------

/** 위치 후보: 같은 법정동이 여러 행정동에 걸치면 행정동마다 하나씩 보여요. */
function placeOptions(head: string): Place[] {
  if (!head) return [];
  const found = findNames(head, PLACES, (p) => p.name);
  // 이미 다 친 이름이고 읍면동이 하나뿐이면 고를 것이 없어요.
  if (found.length && found.every((p) => p.name === head) && found.length === 1) return [];
  return found.slice(0, 12);
}

export function PlaceInput({
  value,
  area,
  onChange,
  onArea,
  road = "",
  onRoad,
  placeholder = "리·동 지번",
  className,
  autoFocus,
}: {
  value: string;
  /** 빈 칸에 보이는 글 (민원처리는 "주소불명 – 리·동 지번") */
  placeholder?: string;
  /** 칸에 더할 모양 이름 */
  className?: string;
  /** 나타나자마자 커서를 둬요(민원처리: 두 번 눌러 고칠 때) */
  autoFocus?: boolean;
  /** 지금 지역 값 (여러 행정동에 걸친 법정동이면 이미 고른 행정동을 지켜요) */
  area: string;
  onChange: (v: string) => void;
  onArea: (emd: string) => void;
  /** 바꾸기 전 도로명주소(마우스를 올리면 보여요) */
  road?: string;
  /** 도로명주소를 바꿨으면 바꾸기 전 글, 손으로 고치면 "" */
  onRoad?: (orig: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const guard = useJamoGuard((v) => {
    onChange(v);
    onRoad?.("");
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);

  // 도로명주소: 치는 동안 미리 물어 둬요(칸을 떠나는 순간 바로 쓰게). 웹 답이 있으면 웹, 아니면 내장 표.
  const look = useRef<{ text: string; r: RoadLookup; src: Src } | null>(null);
  const done = useRef("");
  const [roadPick, setRoadPick] = useState<
    { kind: "cands"; list: RoadHit[]; original: string; src: Src } | { kind: "area"; name: string; areas: string[] } | null
  >(null);
  const [phi, setPhi] = useState(0);
  // 웹 답은 칸 글이 바뀌어도 버리지 않아요(떠난 뒤에 와도 쓰게) – 늦게 온 답은 아래 onWeb이 맞춰요.
  const now = useRef({ value, area, roadPick });
  now.current = { value, area, roadPick };
  const webReq = useRef(new Map<string, Promise<RoadLookup | null>>());
  const webAns = useRef(new Map<string, RoadLookup | null>());
  /** 칸을 떠날 때 남긴 글(늦게 온 웹 답으로 다시 바꿀지 보려고) */
  const left = useRef<{ text: string; value: string } | null>(null);

  function askWeb(t: string) {
    if (webReq.current.has(t)) return;
    const p = webLookup(t);
    webReq.current.set(t, p);
    p.then((r) => onWeb(t, r), () => onWeb(t, null));
  }

  function onWeb(t: string, r: RoadLookup | null) {
    webAns.current.set(t, r);
    if (!r) return;
    if (now.current.value.trim() === t) look.current = { text: t, r, src: "web" };
    if (r.kind !== "exact") return;
    const pick = now.current.roadPick;
    // 내장 후보를 고르는 중이면 웹 답으로 바로 바꿔요.
    if (pick?.kind === "cands" && pick.original === r.original) {
      setRoadPick(null);
      applyHit(r.hit, r.original, true);
      return;
    }
    // 이미 떠났고 칸이 그대로면(내장 답 또는 친 그대로) 웹 답으로 바꿔요.
    const L = left.current;
    if (L && L.text === t && now.current.value.trim() === L.value && L.value !== r.hit.place) {
      left.current = null;
      applyHit(r.hit, r.original, false);
    }
  }

  useEffect(() => {
    const t = value.trim();
    if (!looksRoad(t)) return;
    const w = webAns.current.get(t);
    if (w) {
      look.current = { text: t, r: w, src: "web" };
      return;
    }
    if (look.current?.text !== t) {
      api.roadToJibun(t).then(
        (r) => {
          if (now.current.value.trim() !== t || webAns.current.get(t)) return;
          look.current = { text: t, r, src: "table" };
        },
        () => undefined,
      );
    }
    const timer = window.setTimeout(() => askWeb(t), 300);
    return () => window.clearTimeout(timer);
  }, [value]);

  /** 바꾼 위치를 넣어요. 지역을 골라야 하면 목록을 띄우고 true(칸에 남아요). */
  function applyHit(h: RoadHit, original: string, canStay: boolean): boolean {
    done.current = now.current.value.trim();
    guard.sync(h.place);
    onChange(h.place);
    onRoad?.(original);
    const a = areaFor(h, now.current.area);
    onArea(a);
    setOpen(false);
    if (!a && h.areas.length > 1 && canStay) {
      setRoadPick({ kind: "area", name: h.name, areas: h.areas });
      setPhi(0);
      return true;
    }
    setRoadPick(null);
    return false;
  }

  /** 떠나는 순간: 웹에 아직 안 물었으면 바로 묻고, 남는 글을 적어 둬요. */
  function leaving(t: string, after: string) {
    if (!looksRoad(t)) return;
    askWeb(t);
    left.current = { text: t, value: after };
  }

  /** 지금 글의 찾은 결과(미리 물어 둔 것) */
  const lookNow = () => {
    const t = value.trim();
    return t && t !== done.current && look.current?.text === t ? look.current : null;
  };

  const { head, rest } = splitPlace(value);
  // 리·동 자리를 치는 동안(아직 띄어쓰기 전)만 목록을 보여요.
  const opts = rest === "" && !roadPick ? placeOptions(head) : [];
  const show = open && opts.length > 0;
  const pickN = roadPick ? (roadPick.kind === "cands" ? roadPick.list.length : roadPick.areas.length) : 0;

  function choose(i: number) {
    if (!roadPick) return;
    if (roadPick.kind === "cands") {
      const h = roadPick.list[i] ?? roadPick.list[0];
      setRoadPick(null);
      applyHit(h, roadPick.original, true);
    } else {
      onArea(roadPick.areas[i] ?? roadPick.areas[0]);
      setRoadPick(null);
    }
  }

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  /** 후보를 확정해요: "봉일천리 " + 이미 적은 지번, 지역에 읍면동 */
  function pick(p: Place, keepCaret = true) {
    const tail = rest.replace(/^\s+/, "");
    const next = p.name + " " + tail;
    guard.sync(next);
    if (keepCaret) caret.current = p.name.length + 1;
    onChange(next);
    onArea(p.emd);
    setOpen(false);
  }

  /** 다 쳐 놓고 고르지 않고 떠났을 때: 하나뿐이면 채우고, 이름이 맞으면 지역을 맞춰요. 파주 목록에 없으면 지역을 비워요. */
  function settle() {
    if (opts.length === 1) return pick(opts[0], false);
    const emds = emdsOf(head);
    if (emds.length === 1) onArea(emds[0]);
    else if (!emds.includes(area)) onArea("");
  }

  return (
    <div className="pin">
      <input
        ref={ref}
        name="place"
        aria-label="위치 (법정리·동과 지번)"
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={"cell-input" + (className ? " " + className : "")}
        role="combobox"
        aria-expanded={show || !!roadPick}
        aria-autocomplete="list"
        title={road || undefined}
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => {
          setOpen(true);
          setHi(0);
          done.current = "";
        }}
        onBlur={() => {
          setOpen(false);
          // 고르는 목록을 두고 떠나면 친 그대로(지역 고르기면 지역은 비워 둬요).
          if (roadPick) return setRoadPick(null);
          // 방금 Tab·Enter로 바꿨으면(그리기 전에 떠나요) 다시 손대지 않아요.
          if (done.current && value.trim() === done.current) return;
          // 붙여 쓴 "대원리1234"는 "대원리 1234"로 띄우고 지역을 맞춰요(2026-10-25 사용자).
          const spaced = spacePlace(value);
          if (spaced !== value) {
            onChange(spaced);
            const emds = emdsOf(splitPlace(spaced).head);
            if (emds.length === 1) onArea(emds[0]);
            else if (!emds.includes(area)) onArea("");
            return;
          }
          const t = value.trim();
          const F = lookNow();
          const L = F?.r;
          if (L?.kind === "exact") {
            leaving(t, L.hit.place);
            return void applyHit(L.hit, L.original, false);
          }
          if (L?.kind === "cands") return leaving(t, t);
          if (t && t !== done.current && looksRoad(t) && !look.current) {
            // 아직 답이 오지 않았으면 받은 뒤 꼭 맞을 때만 바꿔요(웹 답이 오면 onWeb이 다시 맞춰요).
            leaving(t, t);
            api.roadToJibun(t).then((r) => {
              if (r.kind !== "exact" || now.current.value.trim() !== t || webAns.current.get(t)) return;
              if (left.current?.text === t) left.current = { text: t, value: r.hit.place };
              applyHit(r.hit, r.original, false);
            }, () => undefined);
            return;
          }
          settle();
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e)) return;
          if (roadPick) {
            if (moveKey(e, pickN, phi, setPhi)) return;
            if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              choose(phi);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setRoadPick(null);
            }
            return;
          }
          if (!show) {
            if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
              const F = lookNow();
              const L = F?.r;
              const t = value.trim();
              if (F && L?.kind === "cands" && L.list.length) {
                e.preventDefault();
                e.stopPropagation();
                askWeb(t);
                setRoadPick({ kind: "cands", list: L.list, original: L.original, src: F.src });
                setPhi(0);
              } else if (L?.kind === "exact") {
                leaving(t, L.hit.place);
                if (applyHit(L.hit, L.original, true)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }
            }
            return;
          }
          if (moveKey(e, opts.length, hi, setHi)) return;
          if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
            // 확정하고 커서는 이 칸에 남아 지번을 이어 써요.
            e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === " " && opts.length === 1) {
            e.preventDefault();
            pick(opts[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {opts.map((p, i) => (
            <div
              key={p.name + p.emd}
              role="option"
              aria-selected={i === hi}
              className="pin-opt pin-place"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span>{p.name}</span>
              <span className="pin-sub">{p.emd}</span>
            </div>
          ))}
          {opts.length > 1 && <div className="pin-hint">↑↓ 고르기 · Tab 확정</div>}
        </div>
      )}
      {roadPick && (
        <div className="pin-list pin-road" role="listbox" aria-label={roadPick.kind === "cands" ? (roadPick.src === "web" ? "맞는 주소" : "가까운 번호") : "지역 고르기"}>
          {roadPick.kind === "cands"
            ? roadPick.list.map((h, i) => (
                <div
                  key={h.road + h.place}
                  role="option"
                  aria-selected={i === phi}
                  className="pin-opt pin-place"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                >
                  <span>{h.road}</span>
                  <span className="pin-sub">{[h.place, h.bldg].filter(Boolean).join(" · ")}</span>
                  <span className={"pin-src" + (roadPick.src === "web" ? " pin-src-web" : "")}>{roadPick.src === "web" ? "웹" : "내장"}</span>
                </div>
              ))
            : roadPick.areas.map((a, i) => (
                <div
                  key={a}
                  role="option"
                  aria-selected={i === phi}
                  className="pin-opt pin-place"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                >
                  <span>{roadPick.name}</span>
                  <span className="pin-sub">{a}</span>
                </div>
              ))}
          <div className="pin-hint">{roadPick.kind === "cands" ? "↑↓ 고르기 · Tab 확정 · Esc 친 그대로" : "↑↓ 고르기 · Tab 확정"}</div>
        </div>
      )}
    </div>
  );
}

// ---------- 목록에서만 고르는 칸 (접수유형, 상태) ----------

/**
 * 적는 칸 + 초성. 설정 목록에 있는 값만 받아요(사용자가 정함: 통계로 셀 값이라 갈라지면 안 돼요).
 * 목록에 없는 값이면 칸에 빨간 테두리가 둘러지고 등록·저장이 안 돼요(allow는 예전 기록의 값처럼 함께 받아 줄 값).
 * 겹치면 첫 후보가 골라진 목록, ↑↓로 바꾸고 Tab(또는 Enter)으로 확정해요.
 * stayOnTab이면 Tab으로 확정한 뒤 그 칸에 머물러요(줄의 마지막 칸이라 Tab이 곧 등록인 곳).
 */
export function ChoiceInput({
  name,
  label,
  value,
  options,
  allow,
  invalid,
  stayOnTab,
  onChange,
  inputRef,
  placeholder,
}: {
  name: string;
  label: string;
  /** 빈 칸 안내 글(처음 값 = label) */
  placeholder?: string;
  value: string;
  options: string[];
  allow?: string;
  invalid?: boolean;
  stayOnTab?: boolean;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);

  const all = allow && !options.includes(allow) ? [...options, allow] : options;
  const v = value.trim();
  const opts = v && all.includes(v) ? [] : v ? findNames(v, all, (x) => x).slice(0, 12) : all.slice(0, 12);
  const show = open && opts.length > 0;

  function pick(x: string) {
    guard.sync(x);
    onChange(x);
    setOpen(false);
  }

  return (
    <div className="pin">
      <input
        ref={inputRef}
        name={name}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder ?? label}
        className={"cell-input" + (invalid ? " invalid" : "")}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={(e) => {
          e.currentTarget.select();
          setHi(0);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // 하나뿐이면 떠날 때 채워요.
          if (v && !all.includes(v) && opts.length === 1) pick(opts[0]);
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e)) return;
          if (!show) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (moveKey(e, opts.length, hi, setHi)) return;
          if (e.key === "Tab" && !e.shiftKey) {
            if (stayOnTab) e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {opts.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === hi}
              className="pin-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </div>
          ))}
          {opts.length > 1 && <div className="pin-hint">↑↓ 고르기 · Tab 확정</div>}
        </div>
      )}
    </div>
  );
}
