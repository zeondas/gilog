//! 민원 지도(2026-11-02 민원 지도 세션, 대기 목록 ✔1·✔2).
//!
//! - 지번 → 좌표는 **오프라인만**: 앱에 넣은 파주시 연속지적 필지 표(`data/map/paju_parcels.bin.gz`, 324,622필지,
//!   필지 테두리 상자 가운데점, EPSG:5181 m)에서 찾아요. 밖으로 아무것도 보내지 않아요(공통 결정 로그 11-02 16:11).
//! - 찾기 규칙: 리·동 + 산 + 본번-부번 **정확** → 없으면 **본번(부번 0)** → 없으면 **같은 본번의 첫 부번**(분필로 새 부번이
//!   생긴 경우) → 없으면 좌표 없음. 어느 단계로 찾았는지 `geo_src`에 적어요(`exact`·`main`·`series`·`none`).
//! - 지도 화면이 읽는 `complaints_map`은 위치·지역·민원유형·접수유형·상태·접수일·좌표만 돌려줘요.
//!   민원인·연락처·내용·조치내용·메모는 읽지도 않아요(시험으로 고정).

use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

use crate::{Result, Store};

static GZ: &[u8] = include_bytes!("../../../data/map/paju_parcels.bin.gz");
const CODE_BASE: u32 = 4_148_000_000;

struct Parcels {
    /// 리·동 이름 → 법정동 코드(−4148000000)
    names: HashMap<String, u32>,
    /// (코드, 산, 본번, 부번) 순 정렬
    recs: Vec<(u32, u8, u16, u16, i32, i32)>,
}

fn parcels() -> &'static Parcels {
    static P: OnceLock<Parcels> = OnceLock::new();
    P.get_or_init(|| load(GZ).unwrap_or(Parcels { names: HashMap::new(), recs: Vec::new() }))
}

fn load(gz: &[u8]) -> Option<Parcels> {
    let mut raw = Vec::new();
    flate2::read::GzDecoder::new(gz).read_to_end(&mut raw).ok()?;
    let mut o = 0usize;
    let take = |o: &mut usize, n: usize| -> Option<&[u8]> {
        let s = raw.get(*o..*o + n)?;
        *o += n;
        Some(s)
    };
    if take(&mut o, 4)? != b"PJP1" {
        return None;
    }
    let u16_at = |b: &[u8]| u16::from_le_bytes([b[0], b[1]]);
    let u32_at = |b: &[u8]| u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let n_names = u16_at(take(&mut o, 2)?) as usize;
    let mut names = HashMap::new();
    for _ in 0..n_names {
        let l = take(&mut o, 1)?[0] as usize;
        let name = String::from_utf8_lossy(take(&mut o, l)?).into_owned();
        let l = take(&mut o, 1)?[0] as usize;
        take(&mut o, l)?; // 읍면 이름(화면 쪽에서만 써요)
        names.insert(name, u32_at(take(&mut o, 4)?));
    }
    let n = u32_at(take(&mut o, 4)?) as usize;
    let mut recs = Vec::with_capacity(n);
    for _ in 0..n {
        let b = take(&mut o, 17)?;
        recs.push((
            u32_at(&b[0..4]),
            b[4],
            u16_at(&b[5..7]),
            u16_at(&b[7..9]),
            i32::from_le_bytes([b[9], b[10], b[11], b[12]]),
            i32::from_le_bytes([b[13], b[14], b[15], b[16]]),
        ));
    }
    Some(Parcels { names, recs })
}

/// 위치 글에서 (리·동 코드, 산, 본번, 부번)을 읽어요.
/// "봉일천리 113 일원" · "봉일천리 산61" · "봉일천리 산 61-2" · "조리읍 대원리 1234" · "운정3동 동패동 1234번지" · "금촌동 329-17, 329-18"
fn parse(place: &str, names: &HashMap<String, u32>) -> Option<(u32, u8, u16, Option<u16>)> {
    let words: Vec<&str> = place.split_whitespace().collect();
    for (i, w) in words.iter().enumerate() {
        // "봉일천리113"처럼 붙여 쓴 것도 받아요: 이름으로 시작하는 가장 긴 것
        let hit = names
            .iter()
            .filter(|(n, _)| w.starts_with(n.as_str()))
            .max_by_key(|(n, _)| n.len());
        let Some((name, &code)) = hit else { continue };
        let rest = format!("{} {}", &w[name.len()..], words[i + 1..].join(" "));
        let mut s = rest.trim_start();
        let mut san = 0u8;
        if let Some(t) = s.strip_prefix('산') {
            san = 1;
            s = t.trim_start();
        }
        let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
        let main: u16 = digits.parse().ok()?;
        let after = &s[digits.len()..];
        let sub = after
            .strip_prefix('-')
            .map(|t| t.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
            .and_then(|d| d.parse().ok());
        return Some((code, san, main, sub));
    }
    None
}

/// 위치 → (x, y, 찾은 단계). 못 찾으면 None.
pub fn geocode(place: &str) -> Option<(f64, f64, &'static str)> {
    let p = parcels();
    let (code, san, main, sub) = parse(place, &p.names)?;
    let find = |sub: u16| {
        p.recs
            .binary_search_by(|r| (r.0, r.1, r.2, r.3).cmp(&(code, san, main, sub)))
            .ok()
            .map(|i| (p.recs[i].4 as f64, p.recs[i].5 as f64))
    };
    if let Some(s) = sub {
        if let Some((x, y)) = find(s) {
            return Some((x, y, "exact"));
        }
    }
    if let Some((x, y)) = find(0) {
        return Some((x, y, if sub.unwrap_or(0) == 0 { "exact" } else { "main" }));
    }
    // 같은 본번의 첫 부번(본번 계열)
    let i = p.recs.partition_point(|r| (r.0, r.1, r.2) < (code, san, main));
    match p.recs.get(i) {
        Some(r) if (r.0, r.1, r.2) == (code, san, main) => Some((r.4 as f64, r.5 as f64, "series")),
        _ => None,
    }
}

/// 필지 표에 든 리·동 수와 필지 수(설정 카드 "지도 자료" 줄).
pub fn parcel_stats() -> (usize, usize) {
    let p = parcels();
    (p.names.len(), p.recs.len())
}

#[allow(dead_code)]
fn code_of(name: &str) -> Option<u32> {
    parcels().names.get(name).map(|c| c + CODE_BASE)
}

/// 좌표를 다시 맞춰요: `only`가 있으면 그 민원만, 없으면 모두. 값이 달라진 줄만 고쳐 써요.
pub(crate) fn refresh_geo(conn: &rusqlite::Connection, only: Option<i64>) -> Result<usize> {
    let mut st = conn.prepare("SELECT id, place, geo_x, geo_y, geo_src FROM complaints WHERE ?1 IS NULL OR id = ?1")?;
    let rows: Vec<(i64, String, Option<f64>, Option<f64>, String)> = st
        .query_map(params![only], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut up = conn.prepare("UPDATE complaints SET geo_x = ?2, geo_y = ?3, geo_src = ?4, geo_at = ?5 WHERE id = ?1")?;
    let today = crate::today_local();
    let mut n = 0;
    for (id, place, ox, oy, osrc) in rows {
        let (x, y, src) = match geocode(&place) {
            Some((x, y, s)) => (Some(x), Some(y), s),
            None => (None, None, "none"),
        };
        if (x, y, src) != (ox, oy, osrc.as_str()) {
            up.execute(params![id, x, y, src, today])?;
            n += 1;
        }
    }
    Ok(n)
}

/// 지도 화면이 읽는 민원 한 건 – 이름·연락처·내용·조치내용·메모는 없어요(✔1).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapComplaint {
    pub id: i64,
    pub place: String,
    pub area: String,
    pub ctype: String,
    pub intake: String,
    pub status: String,
    pub received: String,
    /// EPSG:5181(중부원점) m. 못 찾으면 없음.
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// exact · main · series · none
    pub geo_src: String,
}

impl Store {
    /// 민원 지도 자료: 좌표를 맞춘 뒤(필지 표가 바뀌었거나 아직 안 찾은 것) 지도에 필요한 칸만 읽어요.
    pub fn complaints_map(&mut self) -> Result<Vec<MapComplaint>> {
        let tx = self.conn.transaction()?;
        refresh_geo(&tx, None)?;
        tx.commit()?;
        let mut st = self.conn.prepare(
            "SELECT id, place, area, ctype, intake, status, received, geo_x, geo_y, geo_src
             FROM complaints ORDER BY received DESC, id DESC",
        )?;
        let v = st
            .query_map([], |r| {
                Ok(MapComplaint {
                    id: r.get(0)?,
                    place: r.get(1)?,
                    area: r.get(2)?,
                    ctype: r.get(3)?,
                    intake: r.get(4)?,
                    status: r.get(5)?,
                    received: r.get(6)?,
                    x: r.get(7)?,
                    y: r.get(8)?,
                    geo_src: r.get(9)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ComplaintInput;

    #[test]
    fn table_loads() {
        let (names, n) = parcel_stats();
        assert_eq!(names, 128, "법정리·동 128개(paju.ts와 같아요)");
        assert!(n > 300_000, "필지 {n}");
        assert!(code_of("봉일천리").is_some() && code_of("동패동").is_some() && code_of("금릉리").is_some());
    }

    #[test]
    fn finds_parcels_in_steps() {
        // 정확
        let (x, y, s) = geocode("금촌동 329-17").unwrap();
        assert_eq!(s, "exact");
        assert!((x - 179817.0).abs() < 2.0 && (y - 473785.0).abs() < 2.0, "{x} {y}");
        // "113 일원" → 113(봉일천리 113은 부번 0 필지가 없어 113-1 – 본번 계열), 앞에 읍면이 붙어도
        let g = geocode("봉일천리 113 일원").unwrap();
        assert_eq!(g.2, "series");
        assert!((g.0 - 183870.0).abs() < 2.0 && (g.1 - 471281.0).abs() < 2.0, "{g:?}");
        assert_eq!(geocode("조리읍 봉일천리 113").map(|g| (g.0, g.1)), geocode("봉일천리 113").map(|g| (g.0, g.1)));
        assert_eq!(geocode("운정3동 동패동 1234번지").map(|g| (g.0, g.1)), geocode("동패동 1234").map(|g| (g.0, g.1)));
        // 붙여 써도
        assert_eq!(geocode("봉일천리113").map(|g| (g.0, g.1)), geocode("봉일천리 113").map(|g| (g.0, g.1)));
        // 없는 부번 → 본번 또는 본번 계열
        let g = geocode("금촌동 329-9999").unwrap();
        assert!(g.2 == "main" || g.2 == "series", "{:?}", g);
        // 산은 따로
        let a = geocode("봉일천리 산1");
        let b = geocode("봉일천리 1");
        assert!(a.is_none() || a.map(|g| (g.0, g.1)) != b.map(|g| (g.0, g.1)));
        // 이름이 없거나 지번이 없으면 좌표 없음
        assert!(geocode("시청 앞").is_none());
        assert!(geocode("봉일천리 일원").is_none());
        assert!(geocode("").is_none());
    }

    fn input(place: &str) -> ComplaintInput {
        ComplaintInput {
            intake: "국민신문고".into(),
            received: "2026-10-12".into(),
            ctype: "포트홀".into(),
            area: "조리읍".into(),
            place: place.into(),
            person: "홍길동 010-1111-2222".into(),
            phone: String::new(),
            body: "[{\"t\":\"비밀 내용\"}]".into(),
            action: "[{\"t\":\"비밀 조치\"}]".into(),
            due: String::new(),
            status: "접수".into(),
            done: String::new(),
            road: String::new(),
        }
    }

    #[test]
    fn map_reads_no_personal_fields() {
        let mut s = Store::memory("1234").unwrap();
        let c = s.add_complaint(&input("금촌동 329-17")).unwrap();
        s.set_complaint_memo(c.id, "[{\"t\":\"비밀 메모\"}]").unwrap();
        let v = s.complaints_map().unwrap();
        assert_eq!(v.len(), 1);
        assert!(v[0].x.is_some() && v[0].geo_src == "exact");
        let j = serde_json::to_value(&v).unwrap();
        let keys: Vec<&String> = j[0].as_object().unwrap().keys().collect();
        let mut keys: Vec<&str> = keys.iter().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, ["area", "ctype", "geoSrc", "id", "intake", "place", "received", "status", "x", "y"]);
        let text = j.to_string();
        for secret in ["홍길동", "010-1111-2222", "비밀 내용", "비밀 조치", "비밀 메모"] {
            assert!(!text.contains(secret), "{secret}가 지도 자료에 들어 있어요");
        }
    }

    #[test]
    fn geo_follows_place_changes() {
        let mut s = Store::memory("1234").unwrap();
        let c = s.add_complaint(&input("봉일천리 113")).unwrap();
        let geo = |s: &Store| -> (Option<f64>, String) {
            s.conn.query_row("SELECT geo_x, geo_src FROM complaints WHERE id = ?1", [c.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        let (x1, src) = geo(&s);
        assert!(x1.is_some() && src == "series", "등록하면 바로 좌표({src})");
        s.update_complaint(c.id, &input("금촌동 329-17")).unwrap();
        let (x2, _) = geo(&s);
        assert!(x2.is_some() && x2 != x1, "위치를 고치면 좌표도");
        s.update_complaint(c.id, &input("시청 앞")).unwrap();
        assert_eq!(geo(&s), (None, "none".into()), "못 찾으면 비워요");
        // 가져오기도
        let rows = vec![crate::ComplaintImport { input: input("동패동 1234"), memo: String::new() }];
        s.import_complaints(&rows, true).unwrap();
        let src: String = s.conn.query_row("SELECT geo_src FROM complaints", [], |r| r.get(0)).unwrap();
        assert_ne!(src, "");
    }
}
