// 탐색기에서 가운데 뜨는 창: 같은 이름 묻기(FilesConflict 1안), 지울까요, 일괄 이름 바꾸기(FilesRename).
// 바깥을 누르기 시작했을 때만 닫혀요(onMouseDown + target === currentTarget – 글자를 끌어 고르다 밖에서 떼도 안 닫혀요).
import { useEffect, useMemo, useRef, useState } from "react";
import { Conflict } from "../../filesApi";
import { overlayDown } from "../../useOutsideClose";
import { DialogX } from "../../DialogX";
import {
  CaseMode,
  FsEntry,
  NAME_TOKENS,
  RenameOpts,
  TIME_FORMATS,
  badName,
  bothName,
  formatDate,
  formatSize,
  quickMatch,
  renameOne,
} from "../../files";

/** 탐색기 가운데 창 틀 – 위 오른쪽 × = 취소(✔7, DialogX), 창 이름표(label)는 화면 읽기용 */
function Overlay({ onClose, children, width, label }: { onClose: () => void; children: React.ReactNode; width: number; label: string }) {
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} style={{ width }}>
        {children}
        <DialogX label="닫기(취소)" onClick={onClose} />
      </div>
    </div>
  );
}

export type Decision = "over" | "skip" | "both";

/** 같은 이름의 파일이 있을 때 한 파일씩 물어요. 고른 것과 "나머지도 같게"를 돌려줘요. */
export function ConflictDialog({
  conflict,
  index,
  total,
  op,
  dateFmt,
  onPick,
  onCancel,
}: {
  conflict: Conflict;
  index: number;
  total: number;
  op: "copy" | "move";
  dateFmt: string;
  onPick: (d: Decision, rest: boolean) => void;
  onCancel: () => void;
}) {
  const [rest, setRest] = useState(false);
  const bothRef = useRef<HTMLButtonElement>(null);
  useEffect(() => bothRef.current?.focus(), [conflict]);
  const { src, dst } = conflict;
  const srcNewer = src.modified > dst.modified;
  const card = (e: FsEntry, cap: string, newer: boolean) => (
    <div className="fx-cf-card">
      <span className="fx-cf-cap">{cap}</span>
      <span className="fx-cf-name">{e.name}</span>
      <span className="fx-cf-meta">
        <span>{formatSize(e.size)}</span>
        <span>{formatDate(e.modified, dateFmt)}</span>
        {newer && <span className="fx-new">새것</span>}
      </span>
      <span className="fx-cf-dir">{e.path.slice(0, e.path.length - e.name.length - 1)}</span>
    </div>
  );
  return (
    <Overlay onClose={onCancel} width={600} label="같은 이름의 파일">
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="fx-cf-head">
          <span className="dialog-title">같은 이름의 파일이 있어요</span>
          {total > 1 && <span className="fx-sub">겹치는 {total}개 중 {index + 1}번째</span>}
        </div>
        <div className="fx-cf-cards">
          {card(src, op === "copy" ? "복사할 파일" : "옮길 파일", srcNewer)}
          {card(dst, "이미 있는 파일", !srcNewer && dst.modified !== src.modified)}
        </div>
        <div className="fx-sub fx-cf-both">
          둘 다 두면 새 파일은 <b>{bothName(dst.name)}</b>
        </div>
        <div className="fx-cf-foot">
          {total - index - 1 > 0 && (
            <label className="fx-ck">
              <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} /> 나머지 {total - index - 1}개도 같게
            </label>
          )}
          <span className="fx-grow" />
          <button type="button" className="btn btn-ctrl" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn btn-ctrl" onClick={() => onPick("skip", rest)}>
            건너뛰기
          </button>
          <button type="button" className="btn btn-ctrl fx-warn" onClick={() => onPick("over", rest)}>
            덮어쓰기
          </button>
          <button type="button" ref={bothRef} className="btn-primary btn-ctrl" onClick={() => onPick("both", rest)}>
            둘 다 두기
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** 지울까요? permanent면 완전 삭제(되돌릴 수 없어요) */
export function DeleteDialog({ items, permanent, onYes, onNo }: { items: FsEntry[]; permanent: boolean; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  const first = items[0];
  return (
    <Overlay onClose={onNo} width={460} label="지우기 확인">
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onNo();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">{permanent ? "완전히 지울까요?" : "지울까요?"}</span>
          <span className="fx-sub">
            {items.length === 1 ? first.name : `${first.name} 외 ${items.length - 1}개`}
            {permanent ? " · 휴지통에 남지 않아 되돌릴 수 없어요" : " · 휴지통으로 가요"}
          </span>
        </div>
        <div className="dialog-foot fx-gap">
          <button type="button" className="btn btn-ctrl" onClick={onNo}>
            취소
          </button>
          <button type="button" ref={yes} className="btn btn-ctrl btn-danger" onClick={onYes}>
            {permanent ? "완전히 지우기" : "지우기"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** 실행할까요? – 실행 파일(exe·bat 등)을 열 때(품질 보완 ② ✔1, 지울까요와 같은 모양). Enter 실행 · Esc·바깥 취소 */
export function RunAsk({ path, onYes, onNo }: { path: string; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  const name = path.split(/[\\/]/).pop() || path;
  return (
    <Overlay onClose={onNo} width={460} label="실행 확인">
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onNo();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">실행할까요?</span>
          <span className="fx-sub">{name} · 프로그램이 실행돼요</span>
        </div>
        <div className="dialog-foot fx-gap">
          <button type="button" className="btn btn-ctrl" onClick={onNo}>
            취소
          </button>
          <button type="button" ref={yes} className="btn btn-ctrl btn-danger" onClick={onYes}>
            실행
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** F5·F6 확인(2026-10-20 사용자 1안 – 새로 고침하려다 복사되는 일 막기). Enter 확인 · Esc 취소 */
export function TransferAsk({ items, op, dest, onYes, onNo }: { items: { name: string }[]; op: "copy" | "move"; dest: string; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  const what = items.length === 1 ? items[0].name : `${items[0].name} 외 ${items.length - 1}개`;
  const verb = op === "copy" ? "복사" : "옮기기";
  return (
    <Overlay onClose={onNo} width={460} label={op === "copy" ? "복사 확인" : "옮기기 확인"}>
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onNo();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">{op === "copy" ? "복사할까요?" : "옮길까요?"}</span>
          <span className="fx-sub">
            {what} → {dest}
          </span>
        </div>
        <div className="dialog-foot fx-gap">
          <button type="button" className="btn btn-ctrl" onClick={onNo}>
            취소
          </button>
          <button type="button" ref={yes} className="btn-primary btn-ctrl" onClick={onYes}>
            {verb}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** 예/아니요 작은 창(Enter = 예, Esc = 아니요) */
export function AskDialog({ title, sub, yes, onYes, onNo }: { title: string; sub: string; yes: string; onYes: () => void; onNo: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  // 이름 칸의 Enter로 열리면 같은 Enter가 단추를 누르지 않게 조금 뒤에 커서를 줘요
  useEffect(() => {
    const t = window.setTimeout(() => ok.current?.focus(), 150);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <Overlay onClose={onNo} width={440} label={title}>
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onNo();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">{title}</span>
          <span className="fx-sub">{sub}</span>
        </div>
        <div className="dialog-foot fx-gap">
          <button type="button" className="btn btn-ctrl" onClick={onNo}>
            취소
          </button>
          <button type="button" ref={ok} className="btn-primary btn-ctrl" onClick={onYes}>
            {yes}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

type RenameRow = FsEntry & { parentName: string; folder: string };

/** 일괄 이름 바꾸기 (FreeCommander 창과 같은 구성, 시안 FilesRename.dc.html) */
export function RenameDialog({
  rows,
  where,
  opts,
  dateFmt,
  onOpts,
  onRename,
  onClose,
  canUndo,
  onUndo,
}: {
  rows: RenameRow[];
  where: string;
  opts: RenameOpts;
  dateFmt: string;
  onOpts: (o: RenameOpts) => void;
  onRename: (items: { path: string; name: string }[], close: boolean) => Promise<string | null>;
  onClose: () => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [o, setO] = useState<RenameOpts>(opts);
  const [auto, setAuto] = useState(true);
  const [closeAfter, setCloseAfter] = useState(false);
  const [shown, setShown] = useState<RenameOpts>(opts);
  const [menu, setMenu] = useState<"" | "name" | "ext" | "repl">("");
  const [msg, setMsg] = useState("");
  const set = (p: Partial<RenameOpts>) => {
    const n = { ...o, ...p };
    setO(n);
    onOpts(n);
    if (auto) setShown(n);
  };
  const view = auto ? o : shown;
  const included = rows.filter((r) => (!view.filesOnly || !r.dir) && (!view.types.trim() || r.dir || quickMatch(view.types, r.name)));
  const preview = useMemo(() => {
    const counters = new Map<string, number>();
    const map = new Map<string, string>();
    for (const r of included) {
      const key = view.perFolder ? r.folder : "";
      const i = counters.get(key) ?? 0;
      counters.set(key, i + 1);
      map.set(r.path, renameOne(r.name, r.modified, r.parentName, i, view));
    }
    return map;
  }, [included, view]);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = (r.folder + "\u0000" + (preview.get(r.path) ?? r.name)).toLowerCase();
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const bad = (r: RenameRow) => {
    const n = preview.get(r.path) ?? r.name;
    return badName(n) || (counts.get((r.folder + "\u0000" + n).toLowerCase()) ?? 0) > 1;
  };
  const anyBad = rows.some(bad);
  const changes = included.filter((r) => preview.get(r.path) !== r.name);
  const apply = async (close: boolean) => {
    const err = await onRename(changes.map((r) => ({ path: r.path, name: preview.get(r.path)! })), close);
    setMsg(err ?? "");
  };
  // [확인] (2026-10-26 사용자 1안): 바꾸고 닫기 – 바뀔 이름이 없으면 그냥 닫고, 빨간 줄이 있으면 아무것도 안 해요(아래 줄에 까닭).
  const ok = () => {
    if (anyBad) return;
    if (!changes.length) onClose();
    else void apply(true);
  };
  const insert = (field: "tpl" | "extTpl" | "repl", code: string) => {
    set({ [field]: (o[field] as string) + code } as Partial<RenameOpts>);
    setMenu("");
  };
  const tokenMenu = (field: "tpl" | "extTpl" | "repl", which: "name" | "ext" | "repl") =>
    menu === which && (
      <div className="fx-menu fx-tok-menu" onMouseDown={(e) => e.stopPropagation()}>
        {NAME_TOKENS.map(([code, desc]) => (
          <button key={code} type="button" className="fx-mi" onClick={() => insert(field, code)}>
            <b className="fx-tok">{code}</b>
            {desc}
          </button>
        ))}
      </div>
    );
  const num = (k: "start" | "step" | "digits", label: string, min: number) => (
    <>
      <span className="fx-lbl">{label}</span>
      <input className="input fx-num" type="number" min={min} data-ime="en" value={o[k]} onChange={(e) => set({ [k]: Math.max(min, Number(e.target.value) || min) } as Partial<RenameOpts>)} />
    </>
  );
  return (
    <Overlay onClose={onClose} width={1040} label="일괄 이름 바꾸기">
      <div
        className="fx-rn"
        onMouseDown={() => setMenu("")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (menu) setMenu("");
            else onClose();
          }
        }}
      >
        <div className="fx-rn-head">
          <span className="dialog-title">일괄 이름 바꾸기</span>
          <span className="fx-sub">{where}</span>
        </div>
        <div className="fx-rn-list">
          <div className="fx-rn-row fx-rn-hdr">
            <span>기존 이름</span>
            <span>새 이름</span>
            <span className="fx-r">크기</span>
            <span>수정일</span>
            <span>생성일</span>
            <span>위치</span>
          </div>
          <div className="fx-rn-body">
            {rows.map((r) => {
              const n = preview.get(r.path) ?? r.name;
              const b = bad(r);
              return (
                <div key={r.path} className={b ? "fx-rn-row fx-bad" : "fx-rn-row"} title={b ? "같은 이름이 둘 이상이거나 쓸 수 없는 글자가 있어요" : undefined}>
                  <span className="fx-dim">{r.name}</span>
                  <span className="fx-strong">{n}</span>
                  <span className="fx-r fx-dim">{r.dir ? "" : formatSize(r.size)}</span>
                  <span className="fx-dim">{formatDate(r.modified, dateFmt)}</span>
                  <span className="fx-dim">{formatDate(r.created, dateFmt)}</span>
                  <span className="fx-dim">{r.path.slice(0, r.path.length - r.name.length - 1)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="fx-rn-grid">
          <div className="fx-rn-col">
            <div className="fx-grp">
              <span className="fx-gt">패턴</span>
              <div className="fx-rn-pat">
                <span className="fx-lbl fx-span2">파일 이름</span>
                <span className="fx-lbl fx-span2">파일 확장자</span>
                <input className="input fx-mono" aria-label="파일 이름 패턴" value={o.tpl} onChange={(e) => set({ tpl: e.target.value })} />
                <div className="fx-rel">
                  <button type="button" className="fx-drop" aria-label="이름 자리 표시 넣기" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(menu === "name" ? "" : "name")}>
                    ▾
                  </button>
                  {tokenMenu("tpl", "name")}
                </div>
                <input className="input fx-mono" aria-label="확장자 패턴" value={o.extTpl} onChange={(e) => set({ extTpl: e.target.value })} />
                <div className="fx-rel">
                  <button type="button" className="fx-drop" aria-label="확장자 자리 표시 넣기" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(menu === "ext" ? "" : "ext")}>
                    ▾
                  </button>
                  {tokenMenu("extTpl", "ext")}
                </div>
              </div>
              <div className="fx-rn-case">
                <span className="fx-lbl fx-span2">대소문자</span>
                <select className="input" aria-label="대소문자" value={o.caseMode} onChange={(e) => set({ caseMode: e.target.value as CaseMode })}>
                  <option value="keep">변경하지 않기</option>
                  <option value="lower">모두 소문자</option>
                  <option value="upper">모두 대문자</option>
                  <option value="first">첫 글자만 대문자</option>
                  <option value="words">단어마다 첫 글자 대문자</option>
                </select>
                <select className="input" aria-label="대소문자 범위" value={o.caseExt ? "1" : "0"} disabled={o.caseMode === "keep"} onChange={(e) => set({ caseExt: e.target.value === "1" })}>
                  <option value="0">이름만</option>
                  <option value="1">확장자도</option>
                </select>
              </div>
            </div>
            <div className="fx-grp">
              <span className="fx-gt">찾기 · 바꾸기</span>
              <div className="fx-rn-fr">
                <span className="fx-lbl fx-span2">찾기</span>
                <input className="input" aria-label="찾기" placeholder="찾을 글자" value={o.find} onChange={(e) => set({ find: e.target.value })} />
                <span />
                <span className="fx-lbl fx-span2">바꾸기</span>
                <input className="input" aria-label="바꾸기" placeholder="바꿀 글자" value={o.repl} onChange={(e) => set({ repl: e.target.value })} />
                <div className="fx-rel">
                  <button type="button" className="fx-drop" aria-label="바꾸기 자리 표시 넣기" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(menu === "repl" ? "" : "repl")}>
                    ▾
                  </button>
                  {tokenMenu("repl", "repl")}
                </div>
              </div>
              <div className="fx-rn-cks">
                <label className="fx-ck"><input type="checkbox" checked={o.matchCase} onChange={(e) => set({ matchCase: e.target.checked })} /> 대소문자 구분</label>
                <label className="fx-ck"><input type="checkbox" checked={o.regex} onChange={(e) => set({ regex: e.target.checked })} /> 정규식</label>
                <label className="fx-ck"><input type="checkbox" checked={o.all} onChange={(e) => set({ all: e.target.checked })} /> 모든 발생을 바꾸기</label>
                <label className="fx-ck"><input type="checkbox" checked={o.skipExt} onChange={(e) => set({ skipExt: e.target.checked })} /> 확장자 제외</label>
              </div>
            </div>
          </div>
          <div className="fx-rn-col">
            <div className="fx-grp">
              <span className="fx-gt">다음 유형의 파일만 포함</span>
              <input className="input fx-mono" aria-label="파일 유형" placeholder="*.jpg;*.png" data-ime="en" value={o.types} onChange={(e) => set({ types: e.target.value })} />
              <label className="fx-ck"><input type="checkbox" checked={o.sub} onChange={(e) => set({ sub: e.target.checked })} /> 하위 폴더 포함</label>
              <label className="fx-ck"><input type="checkbox" checked={o.filesOnly} onChange={(e) => set({ filesOnly: e.target.checked })} /> 파일만</label>
            </div>
            <div className="fx-grp">
              <span className="fx-gt">시간 형식</span>
              <select className="input" aria-label="시간 형식" value={o.timeFmt} onChange={(e) => set({ timeFmt: e.target.value })}>
                {TIME_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="fx-grp">
              <span className="fx-gt">번호</span>
              <div className="fx-rn-num">
                {num("start", "시작", 0)}
                {num("step", "증가", 1)}
                {num("digits", "자릿수", 1)}
              </div>
              <label className="fx-ck"><input type="checkbox" checked={o.perFolder} onChange={(e) => set({ perFolder: e.target.checked })} /> 폴더 별 초기화</label>
            </div>
          </div>
          <div className="fx-rn-side">
            <button type="button" className="btn btn-ctrl" onClick={() => setShown(o)}>
              미리 보기 변경
            </button>
            <label className="fx-ck"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setShown(o); }} /> 자동 미리 보기</label>
            <button
              type="button"
              className="btn-primary btn-ctrl fx-mt"
              disabled={anyBad || !changes.length}
              onClick={() => void apply(closeAfter)}
            >
              이름 바꾸기
            </button>
            <label className="fx-ck"><input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} /> 이름 바꾼 후 창 닫기</label>
            <button type="button" className="btn btn-ctrl fx-mt" onClick={() => set({ tpl: "[n]", extTpl: "[e]", caseMode: "keep", find: "", repl: "", types: "", start: 1, step: 1, digits: 2 })}>
              초기화
            </button>
            <button type="button" className="btn btn-ctrl" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn btn-ctrl" disabled={!canUndo} onClick={onUndo}>
              되돌리기
            </button>
            {/* 2026-10-26 user 2안: count + message sit right above [확인] at the bottom of this column; no footer row */}
            <div className="fx-rn-info">
              <span>
                {rows.filter((r) => !r.dir).length} 파일, {rows.filter((r) => r.dir).length} 폴더
              </span>
              {(anyBad || msg) && <span className="fx-err">{anyBad ? "빨간 줄을 고쳐야 바꿀 수 있어요" : msg}</span>}
            </div>
            <button type="button" className="btn-primary btn-ctrl fx-rn-ok" disabled={anyBad} onClick={ok}>
              확인
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/** 이름 하나 받기(새 폴더 이름 등) – 탐색기는 목록 안에서 바로 고치지만, 찾기 결과처럼 그럴 수 없을 때 써요. */
export function NameDialog({ title, value, onOk, onCancel }: { title: string; value: string; onOk: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, [value]);
  return (
    <Overlay onClose={onCancel} width={440} label={title}>
      <div className="dialog-head">
        <span className="dialog-title">{title}</span>
      </div>
      <div className="dialog-body">
        <input
          ref={ref}
          className={badName(v) ? "input fx-bad-input" : "input"}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !badName(v)) onOk(v.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className="dialog-foot fx-gap">
        <button type="button" className="btn btn-ctrl" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn-primary btn-ctrl" disabled={badName(v)} onClick={() => onOk(v.trim())}>
          확인
        </button>
      </div>
    </Overlay>
  );
}
