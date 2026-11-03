// 민원 지도 화면(2026-11-02 민원 지도 세션 – 시안 Map.dc.html·MapJori.dc.html, 대기 목록 ✔1~✔6).
// 민원대장과 별도 모듈: 민원대장 자료에서 위치·지역·민원유형·접수유형·상태·접수일·좌표만 읽어요(이름·연락처·내용은 읽지 않아요).
// 머리 줄 = 제목 · [민원유형][상태][기간](지도 왼쪽 끝선) · 검색(다른 화면과 같은 자리) · 엑셀 자리 비움.
// 왼쪽 = 읍면동 목록(끌어서 280~420px, 저장) · 오른쪽 = 지도 한 장(파주시 전체 또는 읍면 하나).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type MapComplaint } from "../../api";
import { SearchBox } from "../../SearchBox";
import { DateInput, readDate } from "../../DateInput";
import { STATUSES } from "../../settingsStore";
import layersUrl from "../../../data/map/paju_layers.bin.gz?url";
import MapCanvas, { type MapPoint, type Pin } from "./MapCanvas";
import { kakaoReady, kakaoSearch, type Hit } from "./kakao";
import {
  DONGS,
  EUPS,
  GRADES,
  RIVER_OUT,
  REGIONS,
  fieldOf,
  riverGradeOf,
  boundsOf,
  chipOf,
  chipRange,
  defaultStatuses,
  groupByType,
  legalPartsOf,
  loadLayers,
  looksAddress,
  monthDay,
  passes,
  periodLabel,
  regionOf,
  relaxFor,
  typeColors,
  typeOf,
  type Field,
  type Filters,
  type Grade,
  type Layers,
  type Period,
} from "./mapData";

const KV_LIST_W = "map.listW";
const KV_HIDDEN = "map.hidden";
const KV_FIELD = "map.field"; // 분야(✔3) – 설정 › 민원 지도에서 고름
const KV_RIVER_OFF = "map.riverOff"; // 하천 표시 설정에서 끈 등급
const KV_FOLD = "map.listFold"; // 왼쪽 사이드바 접음(✔11)
const LIST_MIN = 280;
const LIST_MAX = 420;
const WIDE = 360; // 이 폭부터 행에 접수유형 열

type Pop = "type" | "status" | "period" | "regions" | "rivers" | null;

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

type ScreenProps = {
  onOpenComplaint: (id: number) => void;
  /** 민원대장에서 "지도에서 보기"로 받은 민원(11-03 ✔5) – 받으면 onFocused로 비워요 */
  focusId?: number | null;
  onFocused?: () => void;
};

export default function MapScreen({ onOpenComplaint, focusId = null, onFocused }: ScreenProps) {
  const [list, setList] = useState<MapComplaint[] | null>(null);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [note, setNote] = useState("");
  const today = useMemo(() => new Date(), []);
  const [f, setF] = useState<Filters>(() => ({ types: null, statuses: defaultStatuses(STATUSES), period: chipRange("year", new Date()), q: "" }));
  const [pop, setPop] = useState<Pop>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [field, setField] = useState<Field>("road");
  const [riverOff, setRiverOff] = useState<Set<string>>(new Set());
  const [listW, setListW] = useState(LIST_MIN);
  const [region, setRegion] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: "", to: "" });
  // 민원현황 패널(11-03 ✔2): ☰로 열고 닫기, 마지막 상태 기억(map.listFold – "1"이면 닫힘, 처음엔 열림)
  const [fold, setFold] = useState(false);
  // 검색창 하나(✔3): 결과 목록(민원 · 주소·장소)이 열려 있는지
  const [sopen, setSopen] = useState(false);
  const sbarRef = useRef<HTMLDivElement>(null);
  // 주소 검색(✔5): 지번은 앱 안 필지 표, 이름·도로명은 카카오(파주시만) – 결과는 저장하지 않아요
  const [sq, setSq] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  const [kakaoOn, setKakaoOn] = useState(false);
  // 재기(✔6): 면적·반경 안 민원만
  const [picked, setPicked] = useState<Set<number> | null>(null);
  // 민원대장에서 받은 민원(✔5): 지도가 그리로 옮겨 닷카드를 열어요 · 좌표가 없으면 안내 한 줄
  const [focus, setFocus] = useState<{ id: number; x: number; y: number; n: number } | null>(null);
  const [hint, setHint] = useState("");
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
    api.get(KV_FIELD).then((v) => alive && setField(fieldOf(v))).catch(() => {});
    api.get(KV_FOLD).then((v) => alive && setFold(v === "1")).catch(() => {});
    api.get(KV_RIVER_OFF).then((v) => {
      try {
        const a = v ? (JSON.parse(v) as string[]) : [];
        if (alive && Array.isArray(a)) setRiverOff(new Set(a.filter((x) => GRADES.some((g) => g.key === x))));
      } catch {
        /* 처음 값 */
      }
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

  const closePop = useCallback(() => setPop(null), []);
  usePopClose(pop === "type" || pop === "status" || pop === "period", closePop, popRef);
  usePopClose(pop === "regions" || pop === "rivers", closePop, regionPopRef);
  const river = field === "river";

  const all = list ?? [];
  const colors = useMemo(() => typeColors(all), [all]);
  const colorOf = useCallback((t: string) => colors.get(t) ?? "#6B7280", [colors]);
  const regionMap = useMemo(() => new Map(all.map((c) => [c.id, regionOf(c)])), [all]);
  const shownRegions = REGIONS.filter((r) => !hidden.has(r));
  // 하천 분야: 민원마다 위치에서 100m 안 가장 가까운 하천 등급(없으면 하천 밖) – ✔3 23:09 1안
  const gradeMap = useMemo(() => {
    const m = new Map<number, Grade | null>();
    if (!river || !layers) return m;
    for (const c of all) m.set(c.id, c.x != null && c.y != null ? riverGradeOf(layers, c.x, c.y) : null);
    return m;
  }, [river, layers, all]);
  const inView = useCallback((c: MapComplaint) => {
    if (river) {
      const g = gradeMap.get(c.id);
      return g ? !riverOff.has(g) : true;
    }
    const r = regionMap.get(c.id) ?? "";
    return r ? !hidden.has(r) : hidden.size === 0;
  }, [river, gradeMap, riverOff, regionMap, hidden]);
  const passed = useMemo(() => all.filter((c) => passes(c, f) && inView(c) && (!picked || picked.has(c.id))), [all, f, inView, picked]);
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
        .filter((c) => c.x != null && c.y != null && (river || !region || regionMap.get(c.id) === region))
        .map((c) => ({ c, x: c.x!, y: c.y!, color: colorOf(typeOf(c)) })),
    [passed, region, regionMap, colorOf, river],
  );
  const legend = useMemo(() => {
    const seen = new Set(points.map((p) => typeOf(p.c)));
    return [...colors.entries()].filter(([t]) => seen.has(t)).map(([type, color]) => ({ type, color }));
  }, [points, colors]);

  const byGrade = useMemo(() => {
    const m = new Map<string, MapComplaint[]>();
    if (!river) return m;
    for (const c of passed) {
      const g = gradeMap.get(c.id) ?? RIVER_OUT;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return m;
  }, [river, passed, gradeMap]);

  const regionFeats = useMemo(() => {
    if (!layers || !region || river) return [];
    const parts = legalPartsOf(region);
    return layers.emd.filter((e) => parts.includes(e.name));
  }, [layers, region]);
  const focusBounds = useMemo(() => (regionFeats.length ? boundsOf(regionFeats) : null), [regionFeats]);

  // 민원대장에서 받은 민원(✔5): 거르기에 걸리면 꼭 필요한 만큼만 풀고(저장은 안 해요), 그 점으로 옮겨 닷카드
  useEffect(() => {
    if (focusId == null || list === null) return;
    onFocused?.();
    const c = list.find((x) => x.id === focusId);
    if (!c) return setHint("그 민원을 지도 자료에서 찾지 못했어요");
    setF((o) => relaxFor(c, o));
    setPicked(null);
    const r = regionMap.get(c.id) ?? "";
    if (river) {
      const g = gradeMap.get(c.id);
      if (g && riverOff.has(g)) setRiverOff((s) => new Set([...s].filter((x) => x !== g)));
    } else {
      if (r && hidden.has(r)) setHidden((s) => new Set([...s].filter((x) => x !== r)));
      if (region && region !== r) setRegion(null);
    }
    if (r) setOpen(r);
    setSelId(c.id);
    if (c.x == null || c.y == null) {
      setFold(false);
      setHint(`${c.place || "(위치 없음)"} – 위치 확인 필요(좌표를 찾지 못해 지도에 없어요)`);
    } else {
      setHint("");
      setFocus((o) => ({ id: c.id, x: c.x!, y: c.y!, n: (o?.n ?? 0) + 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, list]);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(""), 6000);
    return () => clearTimeout(t);
  }, [hint]);

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

  const saveRiverOff = (s: Set<string>) => {
    setRiverOff(s);
    api.set(KV_RIVER_OFF, JSON.stringify([...s])).catch(() => {});
    if (open && s.has(open)) setOpen(null);
  };
  const shownGrades = GRADES.filter((g) => !riverOff.has(g.key));
  const riverOffBg = useMemo(() => (river ? riverOff : new Set<string>()), [river, riverOff]);

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
  const riverTotal = passed.length;
  const total = shownRegions.reduce((n, r) => n + (byRegion.get(r)?.length ?? 0), 0) + (hidden.size === 0 ? byRegion.get("")?.length ?? 0 : 0);

  const itemRow = (c: MapComplaint, last: boolean) => (
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
      <span className={"mp-tg mp-tg-line" + (last ? " mp-tg-end" : "")} />
      <span className="mp-place">{c.place || "(위치 없음)"}</span>
      {wide && <span className="mp-intake">{c.intake}</span>}
      <span className="mp-st">{c.status}</span>
      <span className="mp-date">{monthDay(c.received)}</span>
    </div>
  );

  // 하천 분야 목록(✔3): 하천 전체 › 등급(국가·지방·소하천·하천 밖) › 읍면동 › 민원 – 자료에 하천 이름이 없어서 읍면동으로 묶어요.
  const gradeRow = (key: string, name: string) => {
    const items = byGrade.get(key) ?? [];
    const isOpen = open === key;
    const groups = new Map<string, MapComplaint[]>();
    for (const c of items) {
      const r = regionMap.get(c.id) || "읍면동 모름";
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(c);
    }
    const order = [...groups.keys()].sort((a, b) => (REGIONS.indexOf(a) + 1 || 99) - (REGIONS.indexOf(b) + 1 || 99));
    return (
      <Fragment key={key}>
        <div role="treeitem" aria-expanded={isOpen} className="mp-row mp-reg" onClick={() => setOpen(isOpen ? null : key)}>
          <span className="mp-tg"><Chevron open={isOpen} /></span>
          <span className="mp-name">{name}</span>
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
          order.map((r) => {
            const gk = `${key}|${r}`;
            const gOpen = !folded.has(gk);
            const list = groups.get(r)!.sort((a, b) => b.received.localeCompare(a.received) || b.id - a.id);
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
                  <span className="mp-gname">{r}</span>
                  <span className="mp-gn">{list.length}</span>
                </div>
                {gOpen && list.map((c, i) => itemRow(c, i === list.length - 1))}
              </Fragment>
            );
          })}
      </Fragment>
    );
  };

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
                {gOpen && g.items.map((c, i) => itemRow(c, i === g.items.length - 1))}
              </Fragment>
            );
          })}
      </Fragment>
    );
  };

  const saveFold = (v: boolean) => {
    setFold(v);
    api.set(KV_FOLD, v ? "1" : "0").catch(() => {});
  };
  // ---------- 검색창 하나(✔3): 민원(앱 안) + 주소·장소(지번 = 앱 안 필지 표, 이름·도로명 = 카카오 파주시만) ----------
  const sqT = sq.trim();
  const cmHits = useMemo(() => (sqT ? all.filter((c) => passes(c, { ...f, q: sqT }) && inView(c)) : []), [all, f, sqT, inView]);
  const addrFirst = looksAddress(sqT);
  const groups: ("addr" | "cm")[] = addrFirst ? ["addr", "cm"] : ["cm", "addr"];
  // 민원유형·상태 이름과 똑같은 글은 카카오에 보내지 않아요(민원 검색으로만)
  const ownNames = useMemo(() => new Set([...colors.keys(), ...STATUSES, ...REGIONS]), [colors]);
  const runAddr = async (t: string) => {
    setBusy(true);
    const out: Hit[] = [];
    // 지번은 앱 안 필지 표에서 먼저(밖으로 안 나가요) – 찾으면 카카오에 보내지 않아요.
    if (/\d/.test(t)) {
      try {
        const r = await api.mapGeocode(t);
        if (r) out.push({ name: t, addr: "", x: r[0], y: r[1], src: "jibun" });
      } catch {
        /* 못 찾음 */
      }
    }
    const k = kakaoReady();
    if (!out.length && k && kakaoOn && layers && !ownNames.has(t)) {
      try {
        out.push(...(await kakaoSearch(k, t, layers.bounds)));
      } catch {
        /* 못 찾음 */
      }
    }
    setHits(out);
    setBusy(false);
    return out;
  };
  const goHit = (h: Hit) => {
    setPin({ x: h.x, y: h.y, label: h.name });
    setSopen(false);
  };
  const applyQ = () => {
    setF((o) => ({ ...o, q: sqT }));
    setSopen(false);
  };
  const clearSearch = () => {
    setSq("");
    setHits(null);
    setSopen(false);
    setF((o) => ({ ...o, q: "" }));
  };
  /** Enter: 주소 꼴이 아니고 맞는 민원이 있으면 그 민원만 보기, 아니면 주소·장소 찾기(하나면 바로 그리로) */
  const onEnter = async () => {
    if (!sqT || busy) return;
    setSopen(true);
    if (!addrFirst && cmHits.length) return applyQ();
    const out = await runAddr(sqT);
    if (out.length === 1) goHit(out[0]);
  };
  const closeS = useCallback(() => setSopen(false), []);
  usePopClose(sopen, closeS, sbarRef);
  const onPick = useCallback((ids: number[] | null) => {
    setPicked(ids ? new Set(ids) : null);
    if (ids) {
      setFold(false);
    }
  }, []);
  const pickedBar = picked && (
    <div className="mp-picked">
      <span>재기 안 민원 {picked.size}건만 보여요</span>
      <button type="button" className="mp-meas-x" style={{ position: "static" }} aria-label="모두 보기" title="모두 보기" onClick={() => setPicked(null)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );

  const panelOpen = !fold;
  const overlay = (
    <div className="mp-ovwrap">
      <div className="mp-ov mp-ovbar">
        <div className="mp-sbar" ref={sbarRef}>
          <button type="button" className={"mp-hamb" + (panelOpen ? " mp-hamb-on" : "")} aria-label={panelOpen ? "민원현황 닫기" : "민원현황 열기"} title={panelOpen ? "민원현황 닫기" : "민원현황 열기"} aria-expanded={panelOpen} onClick={() => saveFold(panelOpen)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <SearchBox
            className="mp-sbox"
            aria-label="민원 지도 검색"
            placeholder="주소·장소·민원유형 검색"
            value={sq}
            onChange={(e) => {
              setSq(e.target.value);
              setHits(null);
              setSopen(true);
              if (!e.target.value.trim()) setF((o) => ({ ...o, q: "" }));
            }}
            onFocus={() => setSopen(true)}
            onClear={clearSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void onEnter();
              else if (e.key === "Escape" && sopen) setSopen(false);
            }}
          />
          {sopen && sq.trim() && (
            <div className="mp-sres" role="listbox" aria-label="찾은 것">
              {groups.map((g) =>
                g === "addr" ? (
                  <Fragment key="addr">
                    <h6 className="mp-sres-cap">주소·장소{kakaoOn ? " – 지번은 앱 안, 이름·도로명은 카카오(파주시만)" : " – 지번(앱 안 필지 표)"}</h6>
                    {busy && <p className="mp-sres-empty">찾는 중이에요…</p>}
                    {!busy && !hits && <p className="mp-sres-empty">Enter를 누르면 찾아요</p>}
                    {!busy && hits && hits.length === 0 && <p className="mp-sres-empty">파주시 안에서 찾지 못했어요</p>}
                    {!busy &&
                      hits?.map((h, i) => (
                        <button key={i} type="button" role="option" aria-selected={!!pin && pin.x === h.x && pin.y === h.y} className="mp-sres-row" onClick={() => goHit(h)}>
                          <b>{h.name}</b>
                          <span>{h.addr || (h.src === "jibun" ? "지번 · 앱 안 필지 표" : "카카오")}</span>
                        </button>
                      ))}
                  </Fragment>
                ) : (
                  <Fragment key="cm">
                    <h6 className="mp-sres-cap">민원 – 민원유형·위치·상태·읍면동에 "{sq.trim()}"</h6>
                    {cmHits.length === 0 ? (
                      <p className="mp-sres-empty">맞는 민원이 없어요</p>
                    ) : (
                      <>
                        <button type="button" role="option" aria-selected={f.q === sq.trim()} className="mp-sres-row mp-sres-all" onClick={applyQ}>
                          <b>"{sq.trim()}" 민원만 보기</b>
                          <span className="mp-sres-n">{cmHits.length}건</span>
                        </button>
                        {cmHits.slice(0, 5).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={selId === c.id}
                            className="mp-sres-row mp-sres-cm"
                            onClick={() => {
                              setSelId(c.id);
                              setSopen(false);
                            }}
                          >
                            <i className="mp-dot" style={{ background: colorOf(typeOf(c)) }} />
                            <b>{c.place || "(위치 없음)"}</b>
                            <span>
                              {typeOf(c)} · {c.status} · {monthDay(c.received)}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </Fragment>
                ),
              )}
            </div>
          )}
        </div>
        <div className="mp-chipsbar" ref={popRef}>
          <div className="mp-filters">
            <div className="mp-fwrap">
              <button type="button" className={"mp-fbtn mp-pill" + (pop === "type" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "type"} onClick={() => setPop(pop === "type" ? null : "type")}>
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
              <button type="button" className={"mp-fbtn mp-pill" + (pop === "status" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "status"} onClick={() => setPop(pop === "status" ? null : "status")}>
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
              <button type="button" className={"mp-fbtn mp-pill" + (pop === "period" ? " mp-fopen" : "")} aria-haspopup="true" aria-expanded={pop === "period"} onClick={openPeriod}>
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
        </div>
      </div>
      {panelOpen && (
        <div className="mp-ov mp-list mp-panel" aria-label="민원현황" style={{ width: listW }}>
            <div className="mp-subhead" ref={regionPopRef}>
              {river ? (
                <>
                  <span>
                    하천 표시 <b>{shownGrades.length}</b>/{GRADES.length}
                  </span>
                  <button type="button" className="btn btn-ctrl btn-xs mp-regbtn" aria-expanded={pop === "rivers"} onClick={() => setPop(pop === "rivers" ? null : "rivers")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4" /></svg>
                    하천 표시 설정
                  </button>
                  {pop === "rivers" && (
                    <div className="mp-pop mp-regpop mp-rivpop" role="dialog" aria-label="하천 표시 설정">
                      <div className="mp-regpop-head">
                        <span>
                          하천 표시 <b>{shownGrades.length}</b> / {GRADES.length}
                        </span>
                        <button type="button" className="btn btn-ctrl btn-xs" onClick={() => saveRiverOff(new Set())}>모두 켜기</button>
                        <button type="button" className="btn btn-ctrl btn-xs" onClick={() => saveRiverOff(new Set(GRADES.map((g) => g.key)))}>모두 끄기</button>
                      </div>
                      <div className="mp-rivpop-list">
                        {GRADES.map((g) => (
                          <label key={g.key} className="mp-check">
                            <input
                              type="checkbox"
                              checked={!riverOff.has(g.key)}
                              onChange={() => {
                                const s = new Set(riverOff);
                                if (s.has(g.key)) s.delete(g.key);
                                else s.add(g.key);
                                saveRiverOff(s);
                              }}
                            />
                            <i className="mp-swatch" style={{ background: `var(${g.color})` }} />
                            <span className="mp-check-name">{g.name}</span>
                            <span className="mp-check-n">{layers ? `${layers[g.key].length.toLocaleString()}구역` : ""}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span>
                    관할 <b>{shownRegions.length}</b>/{REGIONS.length}곳
                  </span>
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
                </>
              )}
            </div>
            {river ? (
              <div className="mp-list-body" role="tree" aria-label="하천">
                {pickedBar}
                <div className="mp-row mp-reg mp-all mp-on" role="treeitem" aria-selected>
                  <span className="mp-name">하천 전체</span>
                  <span className="mp-n">{riverTotal}</span>
                </div>
                {shownGrades.map((g) => gradeRow(g.key, g.name))}
                {gradeRow(RIVER_OUT, RIVER_OUT)}
              </div>
            ) : (
              <div className="mp-list-body" role="tree" aria-label="읍면동">
                {pickedBar}
                <div className={"mp-row mp-reg mp-all" + (region === null ? " mp-on" : "")} role="treeitem" aria-selected={region === null} onClick={() => setRegion(null)}>
                  <span className="mp-name">{hidden.size ? "관할 전체" : "파주시 전체"}</span>
                  <span className="mp-n">{total}</span>
                </div>
                {shownRegions.map(regionRow)}
                {shownRegions.length === 0 && <p className="mp-empty">지역 표시 설정에서 읍면동을 켜 주세요.</p>}
              </div>
            )}
          <div className="mp-panel-grip" role="separator" aria-orientation="vertical" aria-label="목록 폭" onPointerDown={onGrip} onPointerMove={onGripMove} onPointerUp={onGripUp} />
        </div>
      )}
    </div>
  );

  return (
    <div className="mp mp-full">
      {note && <p className="note" role="status">{note}</p>}
      {hint && <p className="note mp-hint" role="status">{hint}</p>}
      <div className="mp-body">
        <MapCanvas
          layers={layers}
          field={field}
          off={riverOffBg}
          points={points}
          region={river ? null : region}
          regionFeats={regionFeats}
          focusBounds={focusBounds}
          selectedId={selId}
          legend={legend}
          onOpen={onOpenComplaint}
          onWhole={() => setRegion(null)}
          pin={pin}
          onPick={onPick}
          onMode={setKakaoOn}
          overlay={overlay}
          leftInset={panelOpen ? listW + 12 : 0}
          focus={focus}
        />
      </div>
    </div>
  );
}
