// 민원 지도 화면(2026-11-02 민원 지도 세션 – 시안 Map.dc.html·MapJori.dc.html, 대기 목록 ✔1~✔6).
// 민원대장과 별도 모듈: 민원대장 자료에서 위치·지역·민원유형·접수유형·상태·접수일·좌표만 읽어요(이름·연락처·내용은 읽지 않아요).
// 머리 줄 = 제목 · [민원유형][상태][기간](지도 왼쪽 끝선) · 검색(다른 화면과 같은 자리) · 엑셀 자리 비움.
// 왼쪽 = 읍면동 목록(끌어서 280~420px, 저장) · 오른쪽 = 지도 한 장(파주시 전체 또는 읍면 하나).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type MapComplaint } from "../../api";
import { SearchBox } from "../../SearchBox";
import { DateInput, readDate } from "../../DateInput";
import { useJamoGuard } from "../../koInput";
import { STATUSES } from "../../settingsStore";
import layersUrl from "../../../data/map/paju_layers.bin.gz?url";
import MapCanvas, { type MapPoint } from "./MapCanvas";
import {
  DONGS,
  EUPS,
  REGIONS,
  boundsOf,
  chipOf,
  chipRange,
  defaultStatuses,
  groupByType,
  legalPartsOf,
  loadLayers,
  monthDay,
  passes,
  periodLabel,
  regionOf,
  typeColors,
  typeOf,
  type Filters,
  type Layers,
  type Period,
} from "./mapData";

const KV_LIST_W = "map.listW";
const KV_HIDDEN = "map.hidden";
const LIST_MIN = 280;
const LIST_MAX = 420;
const WIDE = 360; // 이 폭부터 행에 접수유형 열

type Pop = "type" | "status" | "period" | "regions" | null;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="mp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** 바깥 누르기·Esc로 닫히는 떠 있는 상자 */
function usePopClose(open: boolean, close: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, close, ref]);
}

function CheckList({ items, sel, color, onChange }: { items: { name: string; n: number }[]; sel: Set<string>; color?: (n: string) => string; onChange: (s: Set<string>) => void }) {
  const all = items.every((i) => sel.has(i.name));
  return (
    <div className="mp-checks">
      <label className="mp-check mp-check-all">
        <input type="checkbox" checked={all} onChange={() => onChange(all ? new Set() : new Set(items.map((i) => i.name)))} />
        <span>모두</span>
      </label>
      {items.map((i) => (
        <label key={i.name} className="mp-check">
          <input
            type="checkbox"
            checked={sel.has(i.name)}
            onChange={() => {
              const s = new Set(sel);
              if (s.has(i.name)) s.delete(i.name);
              else s.add(i.name);
              onChange(s);
            }}
          />
          {color && <i className="mp-dot" style={{ background: color(i.name) }} />}
          <span className="mp-check-name">{i.name}</span>
          <span className="mp-check-n">{i.n}</span>
        </label>
      ))}
    </div>
  );
}

export default function MapScreen({ onOpenComplaint }: { onOpenComplaint: (id: number) => void }) {
  const [list, setList] = useState<MapComplaint[] | null>(null);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [note, setNote] = useState("");
  const today = useMemo(() => new Date(), []);
  const [f, setF] = useState<Filters>(() => ({ types: null, statuses: defaultStatuses(STATUSES), period: chipRange("year", new Date()), q: "" }));
  const [q, setQ] = useState("");
  const qGuard = useJamoGuard(setQ);
  const [pop, setPop] = useState<Pop>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [listW, setListW] = useState(LIST_MIN);
  const [region, setRegion] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const headRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const regionPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .complaintsMap()
      .then((v) => alive && setList(v))
      .catch((e) => alive && setNote(`민원을 읽지 못했어요 (${e})`));
    loadLayers(layersUrl)
      .then((l) => alive && setLayers(l))
      .catch((e) => alive && setNote(`지도 자료를 읽지 못했어요 (${e})`));
    api.get(KV_LIST_W).then((v) => {
      const n = Number(v);
      if (alive && n >= LIST_MIN && n <= LIST_MAX) setListW(n);
    }).catch(() => {});
    api.get(KV_HIDDEN).then((v) => {
      try {
        const a = v ? (JSON.parse(v) as string[]) : [];
        if (alive && Array.isArray(a)) setHidden(new Set(a.filter((x) => REGIONS.includes(x))));
      } catch {
        /* 처음 값 */
      }
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setF((o) => ({ ...o, q })), [q]);
  const closePop = useCallback(() => setPop(null), []);
  usePopClose(pop === "type" || pop === "status" || pop === "period", closePop, popRef);
  usePopClose(pop === "regions", closePop, regionPopRef);

  const all = list ?? [];
  const colors = useMemo(() => typeColors(all), [all]);
  const colorOf = useCallback((t: string) => colors.get(t) ?? "#6B7280", [colors]);
  const regionMap = useMemo(() => new Map(all.map((c) => [c.id, regionOf(c)])), [all]);
  const shownRegions = REGIONS.filter((r) => !hidden.has(r));
  const inView = useCallback((c: MapComplaint) => {
    const r = regionMap.get(c.id) ?? "";
    return r ? !hidden.has(r) : hidden.size === 0;
  }, [regionMap, hidden]);
  const passed = useMemo(() => all.filter((c) => passes(c, f) && inView(c)), [all, f, inView]);
  const byRegion = useMemo(() => {
    const m = new Map<string, MapComplaint[]>();
    for (const c of passed) {
      const r = regionMap.get(c.id) ?? "";
      if (!m.has(r)) m.set(r, []);
      m.get(r)!.push(c);
    }
    return m;
  }, [passed, regionMap]);

  // 거르기 상자 건수(자기 거르기는 빼고)
  const typeItems = useMemo(() => {
    const n = new Map<string, number>();
    for (const t of colors.keys()) n.set(t, 0);
    for (const c of all) if (passes(c, f, "type") && inView(c)) n.set(typeOf(c), (n.get(typeOf(c)) ?? 0) + 1);
    return [...colors.keys()].map((name) => ({ name, n: n.get(name) ?? 0 }));
  }, [all, f, colors, inView]);
  const statusItems = useMemo(() => {
    const names = [...STATUSES, ...new Set(all.map((c) => c.status).filter((s) => !STATUSES.includes(s)))];
    return names.map((name) => ({ name, n: all.filter((c) => c.status === name && passes(c, f, "status") && inView(c)).length }));
  }, [all, f, inView]);
  const typeSel = f.types ?? new Set(colors.keys());

  const points: MapPoint[] = useMemo(
    () =>
      passed
        .filter((c) => c.x != null && c.y != null && (!region || regionMap.get(c.id) === region))
        .map((c) => ({ c, x: c.x!, y: c.y!, color: colorOf(typeOf(c)) })),
    [passed, region, regionMap, colorOf],
  );
  const legend = useMemo(() => {
    const seen = new Set(points.map((p) => typeOf(p.c)));
    return [...colors.entries()].filter(([t]) => seen.has(t)).map(([type, color]) => ({ type, color }));
  }, [points, colors]);

  const regionFeats = useMemo(() => {
    if (!layers || !region) return [];
    const parts = legalPartsOf(region);
    return layers.emd.filter((e) => parts.includes(e.name));
  }, [layers, region]);
  const focusBounds = useMemo(() => (regionFeats.length ? boundsOf(regionFeats) : null), [regionFeats]);

  // 목록 폭 끌기
  const dragW = useRef<{ x: number; w: number } | null>(null);
  const onGrip = (e: React.PointerEvent) => {
    dragW.current = { x: e.clientX, w: listW };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (dragW.current) setListW(Math.max(LIST_MIN, Math.min(LIST_MAX, dragW.current.w + e.clientX - dragW.current.x)));
  };
  const onGripUp = () => {
    if (!dragW.current) return;
    dragW.current = null;
    api.set(KV_LIST_W, String(listW)).catch(() => {});
  };

  const saveHidden = (s: Set<string>) => {
    setHidden(s);
    api.set(KV_HIDDEN, JSON.stringify([...s])).catch(() => {});
    if (region && s.has(region)) setRegion(null);
    if (open && s.has(open)) setOpen(null);
  };

  const setPeriod = (p: Period) => {
    setF((o) => ({ ...o, period: p }));
    setDraft({ from: p.from, to: p.to });
  };
  const openPeriod = () => {
    setDraft({ from: f.period.from, to: f.period.to });
    setPop(pop === "period" ? null : "period");
  };
  const fromOk = readDate(draft.from);
  const toOk = readDate(draft.to);
  const applyPeriod = () => {
    if (fromOk === null || toOk === null) return;
    const [a, b] = fromOk && toOk && fromOk > toOk ? [toOk, fromOk] : [fromOk, toOk];
    setF((o) => ({ ...o, period: { from: a, to: b, chip: chipOf(a, b, today) } }));
    setPop(null);
  };

  const wide = listW >= WIDE;
  const typeLabel = !f.types || f.types.size === colors.size ? "전체" : f.types.size === 0 ? "없음" : [...f.types].slice(0, 2).join(" · ") + (f.types.size > 2 ? ` 외 ${f.types.size - 2}` : "");
  const stOn = statusItems.filter((s) => f.statuses.has(s.name)).map((s) => s.name);
  const statusLabel = stOn.length === statusItems.length ? "전체" : stOn.length === 0 ? "없음" : stOn.slice(0, 3).join(" · ") + (stOn.length > 3 ? ` 외 ${stOn.length - 3}` : "");
  const total = shownRegions.reduce((n, r) => n + (byRegion.get(r)?.length ?? 0), 0) + (hidden.size === 0 ? byRegion.get("")?.length ?? 0 : 0);

  const regionRow = (r: string) => {
    const items = byRegion.get(r) ?? [];
    const isOpen = open === r;
    return (
      <Fragment key={r}>
        <div
          role="treeitem"
          aria-expanded={isOpen}
          aria-selected={region === r}
          className={"mp-row mp-reg" + (region === r ? " mp-on" : "")}
          onClick={() => setOpen(isOpen ? null : r)}
          onDoubleClick={() => {
            setOpen(r);
            setRegion(r);
          }}
          title="두 번 누르면 이 읍면으로 확대"
        >
          <span className="mp-tg"><Chevron open={isOpen} /></span>
          <span className="mp-name">{r}</span>
          <span className="mp-n">{items.length}</span>
        </div>
        {isOpen && wide && items.length > 0 && (
          <div className="mp-cols" aria-hidden="true">
            <span>위치</span>
            <span>접수유형</span>
            <span>상태</span>
            <span>접수일</span>
          </div>
        )}
        {isOpen &&
          groupByType(items).map((g) => {
            const gk = `${r}|${g.type}`;
            const gOpen = !folded.has(gk);
            return (
              <Fragment key={gk}>
                <div
                  className="mp-row mp-grp"
                  role="treeitem"
                  aria-expanded={gOpen}
                  onClick={() => {
                    const s = new Set(folded);
                    if (s.has(gk)) s.delete(gk);
                    else s.add(gk);
                    setFolded(s);
                  }}
                >
                  <span className="mp-tg mp-tg-line" />
                  <span className="mp-tg"><Chevron open={gOpen} /></span>
                  <i className="mp-dot" style={{ background: colorOf(g.type) }} />
                  <span className="mp-gname">{g.type}</span>
                  <span className="mp-gn">{g.items.length}</span>
                </div>
                {gOpen &&
                  g.items.map((c, i) => (
                    <div
                      key={c.id}
                      role="treeitem"
                      aria-selected={selId === c.id}
                      className={"mp-row mp-item" + (selId === c.id ? " mp-sel" : "") + (c.x == null ? " mp-nogeo" : "")}
                      onClick={() => setSelId(c.id)}
                      onDoubleClick={() => onOpenComplaint(c.id)}
                      title={c.x == null ? "좌표를 찾지 못해 지도에 안 그려요 · 두 번 누르면 민원대장 그 줄" : "두 번 누르면 민원대장 그 줄"}
                    >
                      <span className="mp-tg mp-tg-line" />
                      <span className={"mp-tg mp-tg-line" + (i === g.items.length - 1 ? " mp-tg-end" : "")} />
                      <span className="mp-place">{c.place || "(위치 없음)"}</span>
                      {wide && <span className="mp-intake">{c.intake}</span>}
                      <span className="mp-st">{c.status}</span>
                      <span className="mp-date">{monthDay(c.received)}</span>
                    </div>
                  ))}
              </Fragment>
            );
          })}
      </Fragment>
    );
  };

  return (
    <div className="mp" style={{ "--mp-list": `${listW}px` } as React.CSSProperties}>
      <div className="mp-head tb5" ref={headRef}>
        <h1 className="title">민원 지도</h1>
        <div className="mp-filters" ref={popRef}>
          <div className="mp-fwrap">
            <button type="button" className={"btn btn-ctrl mp-fbtn" + (pop === "type" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "type"} onClick={() => setPop(pop === "type" ? null : "type")}>
              민원유형 <b>{typeLabel}</b>
              <Chevron open />
            </button>
            {pop === "type" && (
              <div className="mp-pop" role="dialog" aria-label="민원유형 거르기">
                <CheckList items={typeItems} sel={typeSel} color={colorOf} onChange={(s) => setF((o) => ({ ...o, types: s.size === colors.size ? null : s }))} />
              </div>
            )}
          </div>
          <div className="mp-fwrap">
            <button type="button" className={"btn btn-ctrl mp-fbtn" + (pop === "status" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "status"} onClick={() => setPop(pop === "status" ? null : "status")}>
              상태 <b>{statusLabel}</b>
              <Chevron open />
            </button>
            {pop === "status" && (
              <div className="mp-pop" role="dialog" aria-label="상태 거르기">
                <CheckList items={statusItems} sel={f.statuses} onChange={(s) => setF((o) => ({ ...o, statuses: s }))} />
              </div>
            )}
          </div>
          <div className="mp-fwrap">
            <button type="button" className={"btn btn-ctrl mp-fbtn" + (pop === "period" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "period"} onClick={openPeriod}>
              기간 <b>{periodLabel(f.period)}</b>
              <Chevron open />
            </button>
            {pop === "period" && (
              <div className="mp-pop mp-period" role="dialog" aria-label="기간">
                <div className="mp-chips">
                  {(["year", "last", "y1", "all"] as const).map((c) => (
                    <button key={c} type="button" className={"mp-chip" + (f.period.chip === c ? " mp-chip-on" : "")} onClick={() => setPeriod(chipRange(c, today))}>
                      {{ year: "올해", last: "작년", y1: "최근 1년", all: "전체" }[c]}
                    </button>
                  ))}
                </div>
                <div className="mp-range">
                  <DateInput base="input mp-date-in" label="시작일" value={draft.from} invalid={fromOk === null} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} onKeyDown={(e) => e.key === "Enter" && applyPeriod()} />
                  <span className="mp-tilde">~</span>
                  <DateInput base="input mp-date-in" label="끝일" value={draft.to} invalid={toOk === null} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} onKeyDown={(e) => e.key === "Enter" && applyPeriod()} />
                  <button type="button" className="btn btn-primary btn-xs mp-apply" disabled={fromOk === null || toOk === null} onClick={applyPeriod}>
                    적용
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <SearchBox
          aria-label="민원 지도 검색"
          placeholder="위치, 민원유형 검색"
          value={q}
          onClear={() => setQ("")}
          onKeyDown={qGuard.onKeyDown}
          onChange={qGuard.onChange}
          onCompositionEnd={qGuard.onCompositionEnd}
        />
        <span className="tb-hole-xl" aria-hidden="true" />
      </div>

      {note && <p className="note" role="status">{note}</p>}

      <div className="mp-body">
        <div className="mp-list" role="tree" aria-label="읍면동">
          <div className="mp-list-head" ref={regionPopRef}>
            <span>읍면동</span>
            <button type="button" className="btn btn-ctrl btn-xs mp-regbtn" aria-expanded={pop === "regions"} onClick={() => setPop(pop === "regions" ? null : "regions")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4" /></svg>
              지역 표시 설정
            </button>
            {pop === "regions" && (
              <div className="mp-pop mp-regpop" role="dialog" aria-label="지역 표시 설정">
                <div className="mp-regpop-head">
                  <span>
                    지역 표시 <b>{shownRegions.length}</b> / {REGIONS.length}
                  </span>
                  <button type="button" className="btn btn-ctrl btn-xs" onClick={() => saveHidden(new Set())}>모두 켜기</button>
                  <button type="button" className="btn btn-ctrl btn-xs" onClick={() => saveHidden(new Set(REGIONS))}>모두 끄기</button>
                </div>
                <div className="mp-regpop-cols">
                  {[EUPS, DONGS].map((col, i) => (
                    <div key={i} className="mp-regpop-col">
                      <span className="mp-regpop-cap">{i === 0 ? "읍·면" : "동"}</span>
                      {col.map((r) => (
                        <label key={r} className="mp-check">
                          <input
                            type="checkbox"
                            checked={!hidden.has(r)}
                            onChange={() => {
                              const s = new Set(hidden);
                              if (s.has(r)) s.delete(r);
                              else s.add(r);
                              saveHidden(s);
                            }}
                          />
                          <span className="mp-check-name">{r}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mp-list-body">
            <div className={"mp-row mp-reg mp-all" + (region === null ? " mp-on" : "")} role="treeitem" aria-selected={region === null} onClick={() => setRegion(null)}>
              <span className="mp-name">{hidden.size ? "관할 전체" : "파주시 전체"}</span>
              <span className="mp-n">{total}</span>
            </div>
            {shownRegions.map(regionRow)}
            {shownRegions.length === 0 && <p className="mp-empty">지역 표시 설정에서 읍면동을 켜 주세요.</p>}
          </div>
        </div>
        <div className="mp-grip" role="separator" aria-orientation="vertical" aria-label="목록 폭" onPointerDown={onGrip} onPointerMove={onGripMove} onPointerUp={onGripUp} />
        <MapCanvas
          layers={layers}
          points={points}
          region={region}
          regionFeats={regionFeats}
          focusBounds={focusBounds}
          selectedId={selId}
          legend={legend}
          onOpen={onOpenComplaint}
          onWhole={() => setRegion(null)}
        />
      </div>
    </div>
  );
}
