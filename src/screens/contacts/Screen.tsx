// 업무연락처 화면이에요. 시안 Contacts.dc.html과 사양서의 "업무연락처" 절을 따라요.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExcelMenu } from "../../ExcelMenu";
import { ProjectImport, contactImports, contactRows, samePerson } from "../../excel";
import { VirtualList } from "../../VirtualList";
import { koIndex } from "../../journal";
import { useJamoGuard } from "../../koInput";
import { api, Contact, ContactsData, errorText, Project } from "../../api";
import { SearchBox } from "../../SearchBox";
import { ProjectList, ViewCard } from "./Table";
import { NewRow, EditCard, ProjectDialog } from "./Dialogs";
import { parseMemo, memoText } from "./parts";

// ---------- 화면 ----------

export default function ContactsScreen() {
  const [data, setData] = useState<ContactsData | null>(null);
  const [q, setQ] = useState("");
  // 이름 초성으로 찾을 때 입력기가 자음을 묶지 않게 해요(ㄳ→ㄱㅅ, Shift 없이 친 ㅆ→ㅅㅅ).
  const qGuard = useJamoGuard(setQ);
  const [sel, setSel] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [memoId, setMemoId] = useState<number | null>(null);
  const [projOpen, setProjOpen] = useState(false);
  const [note, setNote] = useState("");
  // 카드는 보이는 만큼만 그려요(2026-10-21 속도 최적화 – 연락처가 많으면 스크롤이 밀린다고 함).
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);

  useEffect(() => {
    api.contactsData().then(setData, (e) => setNote(errorText(e)));
  }, []);

  // 카드 폭이 바뀌면(창 크기·왼쪽 목록 폭) 줄바꿈이 달라져 재 둔 높이를 버려요.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data === null]);

  /** 저장 쪽을 부르고 돌아온 자료로 다시 그려요. 실패하면 이유를 보여 주고 false를 돌려줘요. */
  const run = useCallback(async (p: Promise<ContactsData>) => {
    try {
      setData(await p);
      setNote("");
      return true;
    } catch (e) {
      setNote(errorText(e));
      return false;
    }
  }, []);

  const projects = data?.projects ?? [];
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const all = data?.contacts ?? [];

  // 고른 프로젝트가 지워졌으면 전체로 돌아가요.
  useEffect(() => {
    if (sel !== null && !byId.has(sel)) setSel(null);
  }, [sel, byId]);

  const query = q.trim().toLowerCase();
  const shown = all.filter((c) => {
    if (sel !== null && !c.projects.includes(sel)) return false;
    if (!query) return true;
    const memo = parseMemo(c.memo).map((l) => l.t).join(" ");
    const hay = [c.name, c.org, c.role, c.mobile, c.tel, c.email, memo, ...c.projects.flatMap((id) => { const p = byId.get(id); return p ? [p.name, p.alias] : []; })]
      .join("\n")
      .toLowerCase();
    if (hay.includes(query)) return true;
    // 이름은 초성으로도 찾아요("ㅂㅈㅎ", "박ㅈ").
    if (/[ㄱ-ㅎ]/.test(query) && koIndex(c.name, query) >= 0) return true;
    // 번호는 줄표 없이 쳐도 찾아요.
    const digits = query.replace(/[^0-9]/g, "");
    return digits.length >= 3 && digits === query.replace(/[-\s]/g, "") && [c.mobile, c.tel].some((n) => n.replace(/[^0-9]/g, "").includes(digits));
  });

  if (!data) {
    return (
      <>
        <h1 className="title">업무연락처</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  return (
    <>
      <div className="ct-head tb5">
        <h1 className="title">업무연락처</h1>
        <button type="button" className="btn btn-ctrl btn-text tb-pop" onClick={() => setProjOpen(true)}>
          사업 관리
        </button>
        <SearchBox
          aria-label="연락처 검색"
          placeholder="이름, 소속, 번호 검색"
          value={q}
          onClear={() => setQ("")}
          onKeyDown={qGuard.onKeyDown}
          onChange={qGuard.onChange}
          onCompositionEnd={qGuard.onCompositionEnd}
        />
        <ExcelMenu
          kind="contacts"
          total={all.length}
          build={() => ({ rows: contactRows(all, projects, data.groups ?? []), intake: [], status: [] })}
          parse={(sheet) => [contactImports(sheet)]}
          count={(rows) => rows[0]?.contacts.length ?? 0}
          note={(sheet) => {
            const n = contactImports(sheet).projects.length;
            return n ? `사업 ${n}개의 축약 공사명·그룹·색도 맞춰요` : "";
          }}
          // 덮어쓰기의 "같은 사람" = 이름 + 소속 + 무선(숫자만) – 칸 값도 파일로 덮고 사업은 더 붙여요(공통 ✔5)
          preview={([r]) => ({ same: r ? r.contacts.filter((c) => all.some((x) => samePerson(x, c))).length : 0, total: all.length })}
          onImport={async ([r], mode) => {
            // 프로젝트(숨긴 열의 그룹·축약 공사명·색)를 먼저 넣어야 연락처의 프로젝트 칸이 그 프로젝트로 이어져요.
            await importProjects(r.projects);
            await api.importContacts(r.contacts, mode === "replace");
            setData(await api.contactsData());
            // "N건을 가져왔어요" – 묻는 창의 N건과 같게(이미 있는 사람에게 프로젝트만 붙인 것도 셈)
            return r.contacts.length;
          }}
        />
      </div>

      <div className="ct-body">
      <ProjectList projects={projects} groups={data.groups ?? []} contacts={all} sel={sel} onSel={setSel} />
      <div className="ct-main">
      {note && <p className="note" role="status">{note}</p>}

      <NewRow projects={projects} groups={data.groups ?? []} onAdd={(c) => run(api.addContact(c))} />

      <div className="ct-grid" ref={gridRef}>
        <VirtualList
          grid
          parentRef={gridRef}
          count={shown.length}
          getKey={(i) => shown[i].id}
          estimate={(i) => cardEstimate(shown[i])}
          pinned={[editId, memoId].map((id) => (id == null ? null : shown.findIndex((c) => c.id === id)))}
          resetKey={gridW}
          render={(i) => {
            const c = shown[i];
            return (
                editId === c.id ? (
                  <EditCard
                    vi={i}
                    groups={data.groups ?? []}
                    contact={c}
                    byId={byId}
                    projects={projects}
                    onCancel={() => setEditId(null)}
                    onSave={async (input) => {
                      if (await run(api.updateContact(c.id, input))) setEditId(null);
                    }}
                    onRemove={async () => {
                      setEditId(null);
                      if (memoId === c.id) setMemoId(null);
                      await run(api.deleteContact(c.id));
                    }}
                  />
                ) : (
                  <ViewCard
                    vi={i}
                    contact={c}
                    byId={byId}
                    q={query}
                    memoOpen={memoId === c.id}
                    onEdit={() => {
                      setMemoId(null);
                      setEditId(c.id);
                    }}
                    onMemoOpen={() => {
                      setEditId(null);
                      setMemoId(c.id);
                    }}
                    onMemoClose={() => setMemoId(null)}
                    onMemoSave={async (lines) => {
                      setMemoId(null);
                      const text = memoText(lines);
                      if (text !== c.memo) await run(api.setContactMemo(c.id, text));
                    }}
                  />
                )
            );
          }}
        />
      </div>

      {all.length === 0 ? (
        <p className="muted small">아직 연락처가 없어요. 위 줄에 이름부터 적고 Enter를 눌러 등록해요.</p>
      ) : shown.length === 0 ? (
        <p className="muted small">맞는 연락처가 없어요.</p>
      ) : null}
      </div>
      </div>

      {projOpen && <ProjectDialog data={data} run={run} onClose={() => setProjOpen(false)} />}
    </>
  );
}

// ---------- 카드 ----------

/** 아직 재지 않은 카드의 높이 추정(보이는 만큼만 그리기) – 이름 줄 + 번호 줄 + 프로젝트 줄 + 메모 줄. 그리면 재서 고쳐요. */
function cardEstimate(c: Contact): number {
  const n = [c.mobile, c.tel, c.email].filter(Boolean).length;
  return 92 + 22 * n + (c.projects.length ? 28 : 0) + 20 * parseMemo(c.memo).length;
}

/**
 * 엑셀 숨긴 열(그룹·축약 공사명·색)로 읽은 프로젝트를 넣어요. 같은 프로젝트(공사명·축약 공사명이 맞는 것)가 있으면
 * 비어 있는 것만 채우고(축약 공사명·그룹·색 – 적어 둔 것은 그대로), 없으면 새로 만들어요.
 */
async function importProjects(list: ProjectImport[]) {
  if (!list.length) return;
  let d = await api.contactsData();
  const same = (p: Project, x: ProjectImport) =>
    p.name === x.name || p.alias === x.name || (!!x.alias && (p.name === x.alias || p.alias === x.alias));
  const tryRun = async (f: () => Promise<ContactsData>) => {
    try {
      d = await f();
    } catch {
      // 이름이 겹치는 등 넣지 못한 칸은 건너뛰어요.
    }
  };
  for (const x of list) {
    let p = d.projects.find((q) => same(q, x));
    const isNew = !p;
    if (!p) {
      await tryRun(() => api.addProject(x.name));
      p = d.projects.find((q) => q.name === x.name);
      if (!p) continue;
    }
    const id = p.id;
    if (x.alias && (isNew || !p.alias || p.alias === p.name)) await tryRun(() => api.setProjectNames(id, p!.name, x.alias));
    if (x.group && (isNew || p.group === null)) await tryRun(() => api.setProjectGroup(id, x.group));
    if (x.color !== null && (isNew || p.color === null)) await tryRun(() => api.setProjectColor(id, x.color));
  }
}
