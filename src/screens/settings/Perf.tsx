// 설정 "재기 기록" 카드(공통 ✔1, 2026-11-07 사용자 1안 – 초시계 대신). 자료 지우기 카드 바로 위.
// 스위치를 켜면 잠금 풀기·화면 바꾸기·민원지도·메모리를 앱이 스스로 재고(src/perfLog.ts), 여기에 최근 5번 중간값을 기준과 함께 보여요.
// 켜짐·값은 이 컴퓨터에만(앱 저장소) 있고, 설정 폴더 load-log.json으로도 써요. 숫자만 – 민원 내용·이름은 없어요.
import { useEffect, useState } from "react";
import { clearPerf, limitOf, onPerf, orderOf, perfFile, perfLog, perfOn, recentMedian, recordMemory, setPerfOn } from "../../perfLog";
import { Toggle } from "./parts";

export function PerfCard() {
  const [on, setOn] = useState(perfOn);
  const [log, setLog] = useState(perfLog);
  const [file, setFile] = useState(perfFile);
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      onPerf(() => {
        setOn(perfOn());
        setLog(perfLog());
        setFile(perfFile());
      }),
    [],
  );
  const names = Object.keys(log).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b, "ko"));
  const shown = (name: string, v: number) => (name.startsWith("메모리") ? `${Math.round(v)}MB` : v >= 1000 ? `${(v / 1000).toFixed(2)}초` : `${Math.round(v)}ms`);
  const memNow = async () => {
    setBusy(true);
    await recordMemory("메모리 · 지금");
    setBusy(false);
  };
  return (
    <section className="card perf-card" aria-label="재기 기록" data-k="성능 속도 빠르기 느림 메모리 재기 부하 시험">
      <div className="card-head mod-head">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 9v4l2.5 2 M10 2h4 M12 2v3" />
        </svg>
        재기 기록
        <span className="clr-head-sub muted small">숫자만 남겨요 – 민원 내용·이름은 없어요</span>
      </div>
      <Toggle
        k="성능 속도 메모리"
        label="빠르기·메모리 재기"
        desc="켜면 잠금 풀기·화면 바꾸기·민원지도·메모리를 앱이 스스로 재요. 꺼 두면 아무것도 재지 않아요."
        on={on}
        onChange={setPerfOn}
      />
      {on && (
        <div className="perf-body">
          {names.length ? (
            <table className="perf-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="num">최근 5번 가운데 값</th>
                  <th className="num">기준</th>
                  <th className="num">잰 수</th>
                </tr>
              </thead>
              <tbody>
                {names.map((n) => {
                  const v = recentMedian(log[n]);
                  const lim = limitOf(n);
                  const over = !!lim && v > lim.v;
                  return (
                    <tr key={n} className={over ? "perf-over" : undefined}>
                      <td>{n}</td>
                      <td className="num">{shown(n, v)}</td>
                      <td className="num muted">{lim ? (lim.unit === "MB" ? `${lim.v}MB 아래` : `${lim.v / 1000}초 안`) : "–"}</td>
                      <td className="num muted">{log[n].length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="perf-empty muted small">아직 잰 값이 없어요. 잠금을 풀고 화면을 옮겨 다니면 여기에 쌓여요.</p>
          )}
          <div className="perf-foot">
            <span className="muted small">{file ? `기록 파일 ${file}` : "기록 파일은 설정 폴더 load-log.json"}</span>
            <span className="perf-btns">
              <button type="button" className="btn btn-ctrl btn-xs" disabled={busy} onClick={memNow}>
                지금 메모리 재기
              </button>
              <button type="button" className="btn btn-ctrl btn-xs" disabled={!names.length} onClick={clearPerf}>
                기록 지우기
              </button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
