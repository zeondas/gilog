// 설정 맨 아래 "자료 지우기" 카드(2026-10-30 설정 ✔1, 공통 결정 로그 10:48 – 시안 Settings.dc.html 맨 아래).
// - 맨 위 스위치를 켜야 화면마다 [모두 지우기]가 보여요. 스위치는 저장하지 않아요(설정 화면을 나가면 꺼짐).
// - 단추를 누르면 공통 "지울까요?" 띠(AskBand – Esc·바깥을 누르면 지우지 않고 접혀요)로 건수를 보여 주고 물어요.
// - 지우기는 core clear.rs가 백업(backup\gilog_날짜_before-clear.gilogbak)을 먼저 남긴 뒤 한 트랜잭션으로 해요.
// - 사용자 결정: ① 할 일은 항목만 ② [전부 지우고 처음부터]는 자료만(설정·구글 연결·팀 공유 설정은 둠)
//   ③ 업무연락처를 지워도 업무일지에 적힌 상대 이름은 남는다고 띠에 한 줄.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ClearCounts, ClearWhat, errorText } from "../../api";
import { AskBand } from "../../AskBand";
import { useOutsideClose } from "../../useOutsideClose";
import { loadShare, refreshShare, shareActive } from "../../budgetShare";
import { scheduleGoogleSync } from "../../google";
import { todayStr } from "../../journal";
import { Toggle } from "./parts";

type Line = {
  what: ClearWhat;
  name: string;
  /** 띠·토스트에 쓰는 큰 단위 건수(0이면 "지울 것 없음") */
  n: number;
  desc: string;
  ask: string;
  /** 띠 아래 작은 줄 */
  sub: string;
};

const BACKUP_NOTE = "지우기 전에 백업을 남겨요";

/** 건수 → 줄 7개 + 전부. `all`은 집행현황 "모든 해"를 골랐는지. */
export function clearLines(c: ClearCounts, year: number, all: boolean): Line[] {
  const bp = all ? c.budgetProjects : c.budgetYearProjects;
  const br = all ? c.budgetRows : c.budgetYearRows;
  const when = all ? "모든 해" : `${year}년`;
  const journal = c.entries || c.days;
  const lines: Line[] = [
    {
      what: "complaints",
      name: "민원대장",
      n: c.complaints + c.cases,
      desc: c.cases ? `민원 ${c.complaints}건 · 민원처리 건 ${c.cases}건도 함께 지워요` : `민원 ${c.complaints}건`,
      ask: `민원대장 민원 ${c.complaints}건`,
      sub: (c.cases ? `민원처리 건 ${c.cases}건도 함께 지워요 · ` : "") + BACKUP_NOTE,
    },
    {
      what: "contacts",
      name: "업무연락처",
      n: c.contacts + c.projects,
      desc: `연락처 ${c.contacts}명 · 사업 ${c.projects}개`,
      ask: `업무연락처 ${c.contacts}명 · 사업 ${c.projects}개`,
      sub: "업무일지 기록에 적힌 상대 이름은 그대로 남아요 · " + BACKUP_NOTE,
    },
    {
      what: "journal",
      name: "업무일지",
      n: journal,
      desc: `기록 ${c.entries}건 · 일지 ${c.days}일`,
      ask: c.entries ? `업무일지 기록 ${c.entries}건` : `업무일지 ${c.days}일`,
      sub: BACKUP_NOTE,
    },
    {
      what: "tasks",
      name: "할 일",
      n: c.tasks,
      desc: `할 일 ${c.tasks}건 · 목록은 둬요`,
      ask: `할 일 ${c.tasks}건`,
      sub: "목록은 그대로예요 · " + BACKUP_NOTE,
    },
    {
      what: "events",
      name: "캘린더 일정",
      n: c.events,
      desc: `내 종류 일정 ${c.events}건 · 공휴일·민원·할 일 마감은 저장된 일정이 아니라 빼요`,
      ask: `캘린더 일정 ${c.events}건`,
      sub: "종류는 그대로예요 · " + BACKUP_NOTE,
    },
    {
      what: "budget",
      name: "집행현황",
      n: bp + br,
      desc: `${when} 세부사업 ${bp}개 · 공사 ${br}건`,
      ask: `집행현황 ${when} 세부사업 ${bp}개 · 공사 ${br}건`,
      sub: BACKUP_NOTE,
    },
    {
      what: "bstatus",
      name: "예산현황",
      n: c.bstatus,
      desc: `직접 적은 값·설정 ${c.bstatus}개 사업 · 집행현황에서 오는 값은 그대로예요`,
      ask: `예산현황 직접 적은 값·설정 ${c.bstatus}개 사업`,
      sub: "집행현황에서 오는 값은 그대로예요 · " + BACKUP_NOTE,
    },
  ];
  const total = c.complaints + c.cases + c.contacts + c.projects + journal + c.tasks + c.events + c.budgetProjects + c.budgetRows + c.bstatus;
  lines.push({
    what: "all",
    name: "전부 지우고 처음부터",
    n: total,
    desc: "위 일곱 가지를 한 번에 지워요(집행현황은 모든 해). 설정·구글 연결·팀 공유 설정은 둬요.",
    ask: `자료 ${total}건`,
    sub: "설정·구글 연결·팀 공유 설정은 그대로예요 · " + BACKUP_NOTE,
  });
  return lines;
}

/** 토스트 글 – 백업 경로는 자료 폴더 안 `backup\…`만 보여요. */
export function clearedText(n: number, backup: string | null): string {
  if (!backup) return `${n}건 지웠어요`;
  const name = backup.split(/[\\/]/).pop() ?? backup;
  return `${n}건 지웠어요 · 백업: backup\\${name}`;
}

export function ClearCard({ setNote }: { setNote: (s: string) => void }) {
  const year = Number(todayStr().slice(0, 4));
  const [on, setOn] = useState(false);
  const [counts, setCounts] = useState<ClearCounts | null>(null);
  const [allYears, setAllYears] = useState(false);
  const [ask, setAsk] = useState<ClearWhat | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [shared, setShared] = useState(false);
  const bandRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => api.clearCounts(year).then(setCounts, (e) => setNote(errorText(e))), [year, setNote]);

  useEffect(() => {
    if (!on) {
      setAsk(null);
      return;
    }
    void reload();
    loadShare().then(
      (s) => setShared(shareActive(s.conf)),
      () => setShared(false),
    );
  }, [on, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // 묻는 띠 바깥을 누르면 지우지 않고 접혀요(사용자가 정한 규칙).
  useOutsideClose(!!ask, [bandRef], () => setAsk(null));

  async function run(what: ClearWhat) {
    setBusy(true);
    try {
      const r = await api.clearData(what, what === "budget" ? (allYears ? null : year) : null);
      setAsk(null);
      setNote("");
      setToast(clearedText(r.n, r.backup));
      await reload();
      // 집행현황 팀 공유: 지운 줄은 맞추기가 공유 시트에 지움 표시로 보내요.
      if (shared && (what === "budget" || what === "all")) void refreshShare().catch(() => {});
      // 구글 캘린더: 일정·민원·할 일 마감이 빠진 것을 내보내요.
      if (what === "complaints" || what === "tasks" || what === "events" || what === "all") scheduleGoogleSync();
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const lines = counts ? clearLines(counts, year, allYears) : [];
  const rows: ReactNode[] = lines.map((l) => {
    const isAll = l.what === "all";
    return (
      <div key={l.what} className={"row clr-row" + (isAll ? " clr-all" : "")} data-clear={l.what}>
        <span className="row-text">
          <span className="row-label">{l.name}</span>
          <span className="muted small">{l.desc}</span>
        </span>
        {l.what === "budget" && (
          <span className="seg" role="radiogroup" aria-label="지울 해">
            {(
              [
                [false, `${year}년만`],
                [true, "모든 해"],
              ] as const
            ).map(([v, t]) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={allYears === v}
                onClick={() => {
                  setAllYears(v);
                  if (ask === "budget") setAsk(null);
                }}
              >
                {t}
              </button>
            ))}
          </span>
        )}
        {l.n ? (
          <button
            type="button"
            className={"btn " + (isAll ? "btn-danger" : "clr-btn")}
            disabled={busy}
            aria-expanded={ask === l.what}
            onClick={() => setAsk(ask === l.what ? null : l.what)}
          >
            {isAll ? "전부 지우기" : "모두 지우기"}
          </button>
        ) : (
          <button type="button" className="btn clr-btn" disabled>
            지울 것 없음
          </button>
        )}
        {l.what === "budget" && shared && (
          <span className="clr-info muted small">팀 공유가 켜져 있어 공유 시트에도 지움 표시가 가요 – 팀원 앱에서도 지워져요.</span>
        )}
        {ask === l.what && l.n > 0 && (
          <AskBand
            bandRef={bandRef}
            className="clr-ask"
            label={`${l.name} 지우기 확인`}
            text={
              <>
                정말 {isAll ? "전부 " : ""}지울까요? {l.ask}
                <small className="clr-sub">{l.sub}</small>
              </>
            }
            yes={isAll ? "전부 지우기" : "지우기"}
            yesDisabled={busy}
            onNo={() => setAsk(null)}
            onYes={() => void run(l.what)}
          />
        )}
      </div>
    );
  });

  return (
    <>
      <section className="card clr-card" aria-label="자료 지우기" data-k="삭제 초기화 처음부터 리셋 모두 지우기 전부">
        <div className="card-head mod-head">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6" />
          </svg>
          자료 지우기
          <span className="clr-head-sub muted small">지우기 전에 백업을 저절로 남겨요</span>
        </div>
        <Toggle
          k="삭제 초기화"
          label="지우기 단추 보이기"
          desc="켜면 화면마다 [모두 지우기]가 보여요. 설정 화면을 나가면 다시 꺼져요."
          on={on}
          onChange={setOn}
        />
        {on && rows}
      </section>
      {toast && (
        <div className="xl-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
