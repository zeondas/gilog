// 탐색기 열 폭 – 모든 창이 같은 열 폭, 끈 열만 저장, 창마다 줄 폭 재기·끄는 동안 바로 칠하기.
import { useColHead } from "../../ColHead";
import type { ColDef } from "../../cols";
import { useMemo, useRef } from "react";
import { DEFAULT_COLS } from "../../files";
import { dateColMin } from "./parts";
import type { useFilesDrag } from "./drag";

export function useFilesCols(c: ReturnType<typeof useFilesDrag>) {
  const { cfg } = c;

  // 열 폭(헤더 열 조정 통일 2026-10-28): 모든 창 공통, 끈 열만 kv `files.cols`. 수정한 날 열은 날짜 형식 글자 폭 아래로 안 줄어요.
  // 두 번 누르기·"내용에 맞춤"은 창마다 그 창 줄을 재는 함수(colFit)를 두고 가장 넓은 값을 써요.
  // 끄는 동안은 화면을 다시 그리지 않고 창마다 줄 폭만 직접 바꿔요(colLive – cols 최적화 3).
  // 둘 다 그리기마다 비우고 지금 그리는 창만 다시 넣어요 – 닫힌 창의 줄이 맞춤에 섞이지 않게(cols 최적화 4).
  const colFit = useRef<Record<number, (k: string) => number | null>>({});
  const colLive = useRef<Record<number, (w: (k: string) => number) => void>>({});
  colFit.current = {};
  colLive.current = {};
  // 날짜 형식 글자 폭은 형식이 바뀔 때만 재요(cols 최적화 6)
  const dateMin = useMemo(() => dateColMin(cfg.dateFmt), [cfg.dateFmt]);
  const colDefs: ColDef[] = [
    { id: "name", label: "이름", init: DEFAULT_COLS.name, text: true },
    { id: "size", label: "크기", init: DEFAULT_COLS.size },
    { id: "modified", label: "수정한 날", init: DEFAULT_COLS.modified, min: Math.max(40, dateMin) },
    { id: "folder", label: "폴더", init: DEFAULT_COLS.folder },
    { id: "type", label: "파일 형식", init: DEFAULT_COLS.type },
  ];
  const colh = useColHead({
    store: "files.cols",
    cols: colDefs,
    measure: (k) => {
      const ws = Object.values(colFit.current).map((f) => f(k)).filter((w): w is number => w != null && w > 0);
      return ws.length ? Math.max(...ws) : null;
    },
    live: (w) => Object.values(colLive.current).forEach((f) => f(w)),
  });
  return { ...c, colFit, colLive, dateMin, colDefs, colh };
}
