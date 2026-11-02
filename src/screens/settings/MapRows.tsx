// 설정 › 민원 지도 카드(2026-11-02 민원 지도 세션 ✔5 – 시안 MapSettings.dc.html). 단추 없음.
// 분야(도로·하천·공원): 1차는 도로만 – 하천·공원은 KRAS 층을 더 받아 넣으면 켜져요(지금은 "자료 없음").
// 지역 표시(관할)는 지도 화면 목록 머리의 떠 있는 상자에서 골라요(여기엔 두지 않아요).
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Row } from "./parts";

export function MapRows() {
  const [stats, setStats] = useState<[number, number] | null>(null);
  useEffect(() => {
    api.mapParcelStats().then(setStats, () => setStats(null));
  }, []);
  return (
    <>
      <Row k="분야 도로 하천 공원 배경" label="분야" desc="배경 층과 민원유형 목록을 분야에 맞춰요. 1차는 도로만, 하천·공원은 자료가 들어오면 켤 수 있어요.">
        <span className="seg" role="radiogroup" aria-label="분야">
          <button type="button" role="radio" aria-checked>도로</button>
          <button type="button" role="radio" aria-checked={false} disabled title="자료 없음">하천</button>
          <button type="button" role="radio" aria-checked={false} disabled title="자료 없음">공원</button>
        </span>
      </Row>
      <Row k="지도 자료 연속지적도 필지 KRAS" label="지도 자료" desc="앱에 들어 있는 자료예요. 새 판은 다음 설치 파일로 들어와요.">
        <span className="map-data">
          <span>연속지적도 2026-10-08 · {stats ? `${stats[1].toLocaleString()}필지` : "–"}</span>
          <span>KRAS 연속주제도 2026-11-02 · 도로구역 700 · 도시계획도로 2,604</span>
        </span>
      </Row>
      <Row k="외부 전송 개인정보 밖으로" label="밖으로 나가는 것" desc="지도는 앱 안 자료로만 그려요. 민원인 이름·연락처·내용은 지도가 읽지 않아요." last>
        <span className="map-none">없음</span>
      </Row>
    </>
  );
}
