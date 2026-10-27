// 업무연락처 조각끼리·다른 화면이 함께 쓰는 것 – 메모 줄(parseMemo·memoText)·사업 색·이름(projectColor·pjLabel·pjFull·pjStyle)·형광(Hl)·복사(copyText)·사업 묶음(pjSections·useFolded·FoldArrow·koSort).
import { useEffect, useState } from "react";
import { BLine, parseLines, stringifyLines } from "../../bullets";
import { api, Project, ProjectGroup } from "../../api";

// ---------- 메모 ----------
// 메모 한 줄은 머릿기호 규칙(bullets.ts)의 줄 모양이에요. b 굵게, s 취소선, k 머릿기호 종류.

export type MemoLine = BLine;

/** 저장된 메모를 줄 목록으로. 예전 모양(nb, 줄바꿈 글자)도 읽어요. */
export const parseMemo = (memo: string): MemoLine[] => parseLines(memo);

export const memoText = (lines: MemoLine[]): string => stringifyLines(lines);

// ---------- 프로젝트 색 ----------

export const COLOR_NAMES = ["회색", "파랑", "주황", "초록", "자주", "청록", "분홍", "노랑"];

export function projectColor(p: Project): number {
  return p.color ?? (p.id - 1) % COLOR_NAMES.length;
}

/** 화면에 보이는 이름: 줄인 이름(관리용)이 있으면 그것, 없으면 정식 이름. */
export const pjLabel = (p: Project) => p.alias || p.name;

/** 문서(지시부·엑셀·인쇄)에 쓰는 이름: 정식 이름. 줄인 이름만 적었으면 줄인 이름이 들어 있어요. */
export const pjFull = (p: Project) => p.name;

export function pjStyle(p: Project) {
  const k = projectColor(p);
  return { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)`, boxShadow: `inset 0 0 0 1px var(--pj-${k}-line)` };
}


/** 검색에 맞은 글자를 형광으로 칠해요. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let at = lower.indexOf(q);
  while (at >= 0 && q) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
    at = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* 아래 방법으로 한 번 더 해요 */
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
export const koSort = (a: Project, b: Project) => pjLabel(a).localeCompare(pjLabel(b), "ko", { numeric: true });

/** 프로젝트가 많아도 한 칸에 세로로 쌓여요. 가나다/많은 순, 찾기, 0명은 맨 아래 "연락처 없음". */
/** 그룹 묶음(그룹 순서대로, "그룹 없음"은 맨 뒤). 그룹이 하나도 없으면 묶음 하나(key "none")예요. */
export type PjSection = { key: string; name: string; id: number | null; projects: Project[] };
export function pjSections(projects: Project[], groups: ProjectGroup[]): PjSection[] {
  const known = new Set(groups.map((g) => g.id));
  const out: PjSection[] = groups.map((g) => ({ key: String(g.id), name: g.name, id: g.id, projects: projects.filter((p) => p.group === g.id) }));
  out.push({ key: "none", name: "그룹 없음", id: null, projects: projects.filter((p) => p.group == null || !known.has(p.group)) });
  return out;
}

const FOLD_KEY = "contacts.foldedGroups";
/** 접은 그룹(왼쪽 목록·관리 창이 같이 써요). */
export function useFolded(): [Set<string>, (key: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.get(FOLD_KEY).then((v) => {
      try {
        if (v) setFolded(new Set(JSON.parse(v) as string[]));
      } catch {
        /* 예전 값은 무시해요 */
      }
    }, () => {});
  }, []);
  const toggle = (key: string) =>
    setFolded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      api.set(FOLD_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  return [folded, toggle];
}

export const FoldArrow = ({ open }: { open: boolean }) => (
  <svg className="grp-arrow" aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
  </svg>
);
