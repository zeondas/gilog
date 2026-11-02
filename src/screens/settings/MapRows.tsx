// 설정 › 민원 지도 카드(2026-11-02 민원 지도 세션 ✔5 – 시안 MapSettings.dc.html, ✔3 MapRiverPark). 단추 없음.
// 분야(도로·하천·공원): 고른 분야로 지도 배경·목록이 바뀌어요(지도 화면이 열릴 때 읽어요).
// 지역 표시(관할)·하천 표시는 지도 화면 목록 머리의 떠 있는 상자에서 골라요(여기엔 두지 않아요).
// "밖으로 나가는 것" 줄은 지웠어요(✔3 사용자 22:19 ⑦).
import { useEffect, useState } from "react";
import { api } from "../../api";
import { FIELDS, fieldOf, type Field } from "../map/mapData";
import { Row } from "./parts";

const KV_FIELD = "map.field";

export function MapRows() {
  const [stats, setStats] = useState<[number, number] | null>(null);
  const [field, setField] = useState<Field>("road");
  useEffect(() => {
    api.mapParcelStats().then(setStats, () => setStats(null));
    api.get(KV_FIELD).then((v) => setField(fieldOf(v)), () => {});
  }, []);
  const pick = (f: Field) => {
    setField(f);
    api.set(KV_FIELD, f).catch(() => {});
  };
  return (
    <>
      <Row k="분야 도로 하천 공원 배경" label="분야" desc="배경 층과 목록을 분야에 맞춰요. 하천은 목록이 하천 등급별로 바뀌어요.">
        <span className="seg" role="radiogroup" aria-label="분야">
          {FIELDS.map((f) => (
            <button key={f.key} type="button" role="radio" aria-checked={field === f.key} onClick={() => pick(f.key)}>
              {f.name}
            </button>
          ))}
        </span>
      </Row>
      <Row k="지도 자료 연속지적도 필지 KRAS 하천 공원" label="지도 자료" desc="앱에 들어 있는 자료예요. 새 판은 다음 설치 파일로 들어와요." last>
        <span className="map-data">
          <span>연속지적도 2026-10-08 · {stats ? `${stats[1].toLocaleString()}필지` : "–"}</span>
          <span>KRAS 도로 2026-11-02 · 도로구역 700 · 도시계획도로 2,604</span>
          <span>KRAS 하천·공원 2026-11-02 · 하천구역 558 · 소하천구역 252 · 공원 1,272</span>
        </span>
      </Row>
    </>
  );
}
