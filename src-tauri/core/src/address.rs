//! 도로명주소 → 법정동 지번 바꾸기 (2026-10-18 사용자, 주소 변환 세션).
//!
//! - 표: `data/paju_roadaddr.txt`(파주시만, 주소정보누리집 전체자료에서 뽑음 — `tools/address/extract.py`).
//!   한 줄 = `도로명|지하|건물본번|건물부번|읍면동|리|산|지번본|지번부|건물명[|행정동]` (행정동 칸은 다음 자료부터).
//!   빌드 때 압축해 넣고(build.rs) 처음 쓸 때 한 번 풀어 도로명마다 색인해요.
//! - 위치 글에서 `○○로/○○길 + 번호(-번호)`를 찾아요. 앞에 "경기도 파주시"·읍면동이 붙어도 되고, 뒤에 붙은 글("앞", "일원")은 남겨요.
//! - 번호가 표에 없으면 같은 도로의 가까운 번호(같은 본번 → 같은 쪽(짝·홀) → 가까운 순) 3개를 후보로 줘요.
//! - 파주시 표에 없는 도로명, 다른 시·군·구가 앞에 적힌 글은 바꾸지 않아요. 지하는 자료에 없어 "지하"라는 말만 건너뛰어요.
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

use serde::Serialize;

static ZIP: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/roadaddr.zip"));

/// 파주시 읍면동과 그 안의 법정리·법정동(앱 화면 `src/paju.ts`와 같은 표)
const PAJU: &[(&str, &str)] = &[
    ("문산읍", "문산리,선유리,이천리,당동리,사목리,마정리,운천리,장산리,임진리,내포리"),
    ("조리읍", "대원리,봉일천리,뇌조리,오산리,장곡리,등원리,능안리"),
    ("법원읍", "법원리,갈곡리,오현리,직천리,웅담리,금곡리,동문리,가야리,대능리,삼방리"),
    ("파주읍", "파주리,연풍리,부곡리,백석리,봉암리,봉서리,향양리"),
    ("광탄면", "용미리,분수리,신산리,창만리,마장리,기산리,영장리,발랑리,방축리"),
    ("탄현면", "축현리,금승리,낙하리,문지리,오금리,금산리,만우리,대동리,성동리,법흥리,갈현리"),
    ("월롱면", "위전리,덕은리,영태리,도내리,능산리"),
    ("적성면", "마지리,식현리,무건리,설마리,적암리,어유지리,장현리,율포리,객현리,구읍리,가월리,주월리,두지리,자장리,답곡리,장좌리"),
    ("파평면", "두포리,율곡리,마산리,금파리,눌노리,덕천리,장파리"),
    ("군내면", "조산리,백연리,읍내리,송산리,점원리,방목리,정자리"),
    ("장단면", "노상리,노하리,거곡리,도라산리,석곶리,강정리,동장리,정동리,덕산리"),
    ("진동면", "동파리,용산리,하포리,서곡리,초리"),
    ("진서면", "금릉리,어용리,선적리"),
    ("교하동", "교하동,당하동,다율동,동패동,산남동,서패동,문발동,신촌동,송촌동,연다산동,오도동,하지석동"),
    ("운정1동", "당하동,와동동"),
    ("운정2동", "목동동"),
    ("운정3동", "동패동,야당동"),
    ("운정4동", "상지석동,야당동"),
    ("운정5동", "다율동,동패동,문발동,신촌동,연다산동"),
    ("운정6동", "동패동"),
    ("금촌1동", "아동동,금촌동,금릉동"),
    ("금촌2동", "금촌동,금릉동"),
    ("금촌3동", "아동동,금촌동,야동동,검산동,맥금동"),
];

/// 법정동이 속한 읍면동(행정동)들 — 여럿이면 화면이 고르게 해요.
pub fn areas_of_dong(dong: &str) -> Vec<String> {
    PAJU.iter().filter(|(_, list)| list.split(',').any(|n| n == dong)).map(|(e, _)| e.to_string()).collect()
}

#[derive(Debug, Clone)]
struct Row {
    main: u32,
    sub: u32,
    emd: String,
    ri: String,
    san: bool,
    jmain: String,
    jsub: String,
    bldg: String,
    adm: String,
}

fn table() -> &'static HashMap<String, Vec<Row>> {
    static T: OnceLock<HashMap<String, Vec<Row>>> = OnceLock::new();
    T.get_or_init(|| {
        let mut text = String::new();
        if let Ok(mut z) = zip::ZipArchive::new(std::io::Cursor::new(ZIP)) {
            if let Ok(mut f) = z.by_index(0) {
                let _ = f.read_to_string(&mut text);
            }
        }
        let mut m: HashMap<String, Vec<Row>> = HashMap::new();
        for line in text.lines() {
            let c: Vec<&str> = line.split('|').collect();
            if c.len() < 10 || c[1] != "0" {
                continue; // 지하 건물은 받지 않아요
            }
            let (Ok(main), Ok(sub)) = (c[2].parse::<u32>(), c[3].parse::<u32>()) else { continue };
            m.entry(c[0].to_string()).or_default().push(Row {
                main,
                sub,
                emd: c[4].into(),
                ri: c[5].into(),
                san: c[6] == "1",
                jmain: c[7].into(),
                jsub: c[8].into(),
                bldg: c[9].into(),
                adm: c.get(10).copied().unwrap_or("").into(),
            });
        }
        for v in m.values_mut() {
            v.sort_by_key(|r| (r.main, r.sub));
        }
        m
    })
}

/// 바꾼 결과 하나
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadHit {
    /// 위치 칸에 들어갈 글: "봉일천리 5-31"(뒤에 붙은 글이 있으면 함께)
    pub place: String,
    /// 리·동 이름("봉일천리", "아동동")
    pub name: String,
    /// 지역 칸 후보 — 하나면 바로 채우고, 여럿이면 화면이 고르게 해요
    pub areas: Vec<String>,
    pub bldg: String,
    /// 표의 도로명주소("통일로 136", "금정로 20-1")
    pub road: String,
}

/// 찾은 결과
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RoadLookup {
    /// 도로명주소가 아니거나 파주시 밖이에요 — 그대로 둬요.
    None,
    /// 표에 있어요. `original`은 바꾸기 전 글(마우스를 올리면 보여요).
    Exact { hit: RoadHit, original: String },
    /// 도로는 있는데 번호가 없어요 — 가까운 번호 후보.
    Cands { list: Vec<RoadHit>, original: String },
}

fn hit(name: &str, r: &Row, rest: &str) -> RoadHit {
    let place_name = if r.ri.is_empty() { r.emd.clone() } else { r.ri.clone() };
    let mut jibun = String::new();
    if r.san {
        jibun.push_str("산 ");
    }
    jibun.push_str(&r.jmain);
    if !r.jsub.is_empty() && r.jsub != "0" {
        jibun.push('-');
        jibun.push_str(&r.jsub);
    }
    let mut place = format!("{place_name} {jibun}");
    if !rest.is_empty() {
        place.push(' ');
        place.push_str(rest);
    }
    let areas = if !r.ri.is_empty() {
        vec![r.emd.clone()]
    } else if !r.adm.is_empty() {
        vec![r.adm.clone()]
    } else {
        areas_of_dong(&r.emd)
    };
    let road = if r.sub > 0 { format!("{name} {}-{}", r.main, r.sub) } else { format!("{name} {}", r.main) };
    RoadHit { place, name: place_name, areas, bldg: r.bldg.clone(), road }
}

/// "136", "20-3", "136번지," → (136, 0 또는 3, 남은 글)
fn number(tok: &str) -> Option<(u32, u32, String)> {
    let digits: String = tok.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let mut rest = &tok[digits.len()..];
    let mut sub = 0;
    if let Some(after) = rest.strip_prefix('-') {
        let d: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !d.is_empty() {
            sub = d.parse().ok()?;
            rest = &after[d.len()..];
        }
    }
    let rest = rest.trim_start_matches(|c: char| c == ',' || c == '번' || c == '지').to_string();
    Some((digits.parse().ok()?, sub, rest))
}

fn ends_road(s: &str) -> bool {
    s.ends_with('로') || s.ends_with('길')
}

/// 앞에 다른 시·군·구·도가 적혀 있으면 파주시 주소가 아니에요.
fn foreign(prefix: &[&str]) -> bool {
    // "입구"·"보도" 같은 말을 잘못 보지 않게 시·군만 보고, 구는 바로 앞이 시일 때만 봐요.
    let clean = |t: &str| t.trim_matches(|c: char| c == ',' || c == '(' || c == ')').to_string();
    let p: Vec<String> = prefix.iter().map(|t| clean(t)).collect();
    p.iter().enumerate().any(|(i, t)| {
        if t == "파주시" || t.chars().count() < 2 {
            return false;
        }
        t.ends_with('시') || t.ends_with('군') || (t.ends_with('구') && i > 0 && p[i - 1].ends_with('시') && p[i - 1] != "파주시")
    })
}

/// 위치 글을 법정동 지번으로 바꿔 봐요.
pub fn road_to_jibun(text: &str) -> RoadLookup {
    let original = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let toks: Vec<&str> = original.split(' ').filter(|t| !t.is_empty()).collect();
    let t = table();
    for i in 0..toks.len() {
        // 도로명 후보: 이 낱말, 또는 앞 낱말과 이은 것("금정로 12번길" → "금정로12번길")
        let mut names: Vec<(String, usize)> = Vec::new();
        if i > 0 {
            names.push((format!("{}{}", toks[i - 1], toks[i]), i - 1));
        }
        names.push((toks[i].to_string(), i));
        for (name, start) in names {
            // 붙여 쓴 "통일로136"도 받아요.
            let (name, glued) = match name.find(|c: char| c.is_ascii_digit()) {
                Some(p) if p > 0 && ends_road(&name[..p]) && !name[p..].contains("번길") => (name[..p].to_string(), Some(name[p..].to_string())),
                _ => (name, None),
            };
            if !ends_road(&name) {
                continue;
            }
            let Some(rows) = t.get(&name) else { continue };
            // 번호
            let mut j = i + 1;
            let num_tok = match &glued {
                Some(g) => g.clone(),
                None => {
                    if toks.get(j) == Some(&"지하") {
                        j += 1;
                    }
                    match toks.get(j) {
                        Some(s) => s.to_string(),
                        None => continue,
                    }
                }
            };
            let Some((main, sub, left)) = number(&num_tok) else { continue };
            if foreign(&toks[..start]) {
                return RoadLookup::None;
            }
            let after = if glued.is_some() { i + 1 } else { j + 1 };
            let mut rest: Vec<&str> = Vec::new();
            if !left.is_empty() {
                rest.push(&left);
            }
            rest.extend(&toks[after.min(toks.len())..]);
            let rest = rest.join(" ");
            if let Some(r) = rows.iter().find(|r| r.main == main && r.sub == sub) {
                return RoadLookup::Exact { hit: hit(&name, r, &rest), original };
            }
            // 가까운 번호: 같은 본번 → 같은 쪽(짝·홀) → 가까운 순 → 부번
            let mut c: Vec<&Row> = rows.iter().collect();
            c.sort_by_key(|r| {
                let sd = if r.main == main { (r.sub as i64 - sub as i64).abs() } else { r.sub as i64 };
                (r.main != main, (r.main % 2) != (main % 2), (r.main as i64 - main as i64).abs(), r.main, sd)
            });
            let list = c.into_iter().take(3).map(|r| hit(&name, r, &rest)).collect();
            return RoadLookup::Cands { list, original };
        }
    }
    RoadLookup::None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exact(s: &str) -> RoadHit {
        match road_to_jibun(s) {
            RoadLookup::Exact { hit, .. } => hit,
            other => panic!("{s}: {other:?}"),
        }
    }

    #[test]
    fn examples() {
        let h = exact("파주시 시청로 50");
        assert_eq!((h.place.as_str(), h.bldg.as_str()), ("아동동 215-1", "파주시청"));
        assert_eq!(h.areas, vec!["금촌1동", "금촌3동"]);
        let h = exact("조리읍 통일로 136");
        assert_eq!((h.place.as_str(), h.areas.clone()), ("봉일천리 5-31", vec!["조리읍".to_string()]));
        assert_eq!(exact("문산읍 문향로 61").place, "문산리 10-108");
        let h = exact("탄현면 필승로 500");
        assert_eq!((h.place.as_str(), h.areas[0].as_str()), ("성동리 663-3", "탄현면"));
        let h = exact("경의로 1246");
        assert_eq!((h.place.as_str(), h.areas.clone()), ("와동동 1454-1", vec!["운정1동".to_string()]));
        match road_to_jibun("금정로 20-3") {
            RoadLookup::Cands { list, .. } => {
                let roads: Vec<&str> = list.iter().map(|h| h.road.as_str()).collect();
                assert_eq!(roads, vec!["금정로 20", "금정로 18", "금정로 22"]);
                assert_eq!(list[0].place, "금촌동 774-21");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn prefixes_and_rest() {
        assert_eq!(exact("경기도 파주시 조리읍 통일로 136 앞").place, "봉일천리 5-31 앞");
        assert_eq!(exact("통일로136").place, "봉일천리 5-31");
        assert_eq!(exact("문향로 61-1").place, "문산리 8-4");
        // 산 지번
        assert!(exact("가나무로 107").place.starts_with("금촌동 산 25-4"));
    }

    #[test]
    fn leaves_others() {
        assert_eq!(road_to_jibun("봉일천리 113 일원"), RoadLookup::None);
        assert_eq!(road_to_jibun("서울특별시 은평구 통일로 136"), RoadLookup::None);
        assert_eq!(road_to_jibun("없는로 10"), RoadLookup::None);
        assert_eq!(road_to_jibun(""), RoadLookup::None);
        assert_eq!(road_to_jibun("통일로"), RoadLookup::None);
    }
}
