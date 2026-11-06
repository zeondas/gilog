//! 3년치 실제 자료 파일(2026-11-07, 결정 로그 11-07 07:41 ②) – tools/load/seed.js와 같은 양·같은 비율:
//! 민원 1,500(위치는 places.json – 필지 표에 있는 실제 파주 지번) · 연락처 800 · 사업 30 · 할 일 6,000 · 업무일지 평일 8건(6,264) ·
//! 일정 평일 2건 + 반복 10(1,578). 민원인 이름·연락처는 가짜(홍길동·010-0000-0000류)만 써요.
//!
//!   cargo run --release --manifest-path tools/load/make_db/Cargo.toml -- <빈 폴더> [암호=test]
//!   cargo run --release --manifest-path tools/load/make_db/Cargo.toml -- --bench <자료 폴더> [암호=test]
//!
//! --bench: 파일을 임시 폴더에 복사해 앱과 같은 네이티브 core로 열기(Argon2)·지도 자료 첫 읽기(필지 표 풀기 + 1,500건 좌표 찾기)·
//! 두 번째 읽기를 재요(원본 파일은 건드리지 않아요 – 원본은 지도 표지가 없어 앱에서 처음 열 때 1,500건을 모두 찾아요).
use gilog_core::*;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

struct Rng(u64);
impl Rng {
    fn f(&mut self) -> f64 {
        self.0 = (self.0.wrapping_mul(1103515245).wrapping_add(12345)) % 2147483648;
        self.0 as f64 / 2147483648.0
    }
    fn int(&mut self, a: i64, b: i64) -> i64 {
        a + (self.f() * (b - a + 1) as f64) as i64
    }
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[(self.f() * v.len() as f64) as usize]
    }
}

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).expect("입력 모양")
}

/// 2023-10-18 ~ 2026-10-17 평일
fn weekdays() -> Vec<String> {
    let mut out = vec![];
    let (mut y, mut m, mut d) = (2023i32, 10u32, 18u32);
    let mdays = |y: i32, m: u32| match m {
        2 => if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 29 } else { 28 },
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    // 2023-10-18은 수요일(요일 0=일)
    let mut wd = 3;
    loop {
        if wd % 6 != 0 {
            out.push(format!("{y}-{m:02}-{d:02}"));
        }
        if (y, m, d) == (2026, 10, 17) {
            break;
        }
        d += 1;
        wd = (wd + 1) % 7;
        if d > mdays(y, m) {
            d = 1;
            m += 1;
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    }
    out
}

fn add_days(s: &str, n: i64) -> String {
    let (y, m, d): (i64, i64, i64) = (s[0..4].parse().unwrap(), s[5..7].parse().unwrap(), s[8..10].parse().unwrap());
    // 날 수로 바꿔 더하고 되돌려요(1970년 기준 민간 달력)
    let days = |y: i64, m: i64, d: i64| {
        let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let doy = (153 * m + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe
    };
    let z = days(y, m, d) + n;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y}-{m:02}-{d:02}")
}

fn make(dir: &Path, pw: &str) {
    let here = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let places: Vec<(String, String)> = serde_json::from_str(&std::fs::read_to_string(here.join("places.json")).unwrap()).unwrap();
    let t0 = Instant::now();
    let mut st = Store::create(dir, pw).expect("새 자료 파일");
    let mut r = Rng(20261107);
    let days = weekdays();
    let at = |i: usize, n: usize| days[(i * days.len() / n).min(days.len() - 1)].clone();
    let sur: Vec<char> = "김이박최정강조윤장임한오서신권황안송류홍".chars().collect();
    let giv = ["민수", "영희", "정호", "지훈", "수진", "현우", "은지", "성민", "미경", "상훈", "다은", "준영", "혜진", "동욱", "선영"];
    let what = ["포트홀 보수 요청", "배수구 막힘 확인", "차선 도색 흐림", "보도블록 들뜸", "가로수 가지 정리", "도로 침하 확인", "맨홀 뚜껑 소음", "방호벽 파손", "제설 요청", "가드레일 휨", "도로 표지 훼손", "측구 정비"];
    let more = ["현장 사진 첨부", "야간 통행 위험", "주민 여러 명 같은 민원", "지난달에도 같은 곳 신고", "비 오면 물 고임", "학교 앞 통학로", "버스 정류장 앞", "농로 이어지는 곳"];
    let act = ["현장 확인 완료", "보수 업체 작업 지시", "아스콘 덧씌우기 예정", "배수구 준설 실시", "관계 부서 이첩", "민원인 유선 안내", "다음 주 작업 예정", "작업 완료 사진 촬영"];
    let intake = ["전화", "방문", "국민신문고", "국민신문고", "국민신문고", "정보공개청구", "진정민원"];
    let ctype = ["포트홀", "배수불량", "차선도색", "보도", "가로수", "침하", "시설물", "제설", "기타"];
    let tt = ["공문 회신", "예산 요구서 작성", "현장 점검", "준공 검사", "설계 검토", "실정보고", "행정사무감사 자료", "기성 검사", "회의 자료 준비", "업체 연락"];
    let orgs = ["72사단", "○○설계", "도로관리과", "건설과", "△△건설", "□□엔지니어링", "읍사무소", "경기도청", "한국전력", "KT"];
    let roles = ["과장", "주무관", "팀장", "대리", "소장", "시설장교", "현장대리인"];
    let name = |r: &mut Rng| format!("{}{}", r.pick(&sur), r.pick(&giv));
    // 가짜 번호만(010-0000-NNNN, 031-000-NNNN)
    let phone = |r: &mut Rng| format!("010-0000-{:04}", r.int(0, 9999));
    let lines = |r: &mut Rng, pool: &[&str], a: i64, b: i64| {
        let n = r.int(a, b);
        let v: Vec<Value> = (0..n)
            .map(|_| {
                let t = r.pick(pool).to_string();
                let t = if r.f() < 0.3 { format!("{t} – {}", r.pick(&more)) } else { t };
                json!({ "t": t })
            })
            .collect();
        Value::Array(v).to_string()
    };

    // 사업 30 · 연락처 800
    let proj: Vec<String> = (0..30).map(|i| format!("시도{}호선 도로정비", i + 3)).collect();
    for (i, p) in proj.iter().enumerate() {
        let id = st.add_project(p).unwrap();
        if i % 3 == 0 {
            st.set_project_names(id, p, &format!("시도{}", i + 3)).unwrap();
        }
    }
    let people: Vec<ContactImport> = (0..800)
        .map(|i| {
            let ps: Vec<String> = {
                let mut v: Vec<String> = (0..r.int(0, 3)).map(|_| r.pick(&proj).clone()).collect();
                v.dedup();
                v
            };
            from(json!({
                "name": name(&mut r), "org": r.pick(&orgs), "role": r.pick(&roles), "mobile": phone(&mut r),
                "tel": if r.f() < 0.5 { format!("031-000-{:04}", r.int(0, 9999)) } else { String::new() },
                "email": if r.f() < 0.3 { format!("user{i}@ex.kr") } else { String::new() },
                "memo": if r.f() < 0.25 { lines(&mut r, &more, 1, 3) } else { String::new() },
                "projects": ps,
            }))
        })
        .collect();
    st.import_contacts(&people, false).unwrap();
    let contacts = st.contacts_data().unwrap().contacts;

    // 민원 1,500(오래된 것은 대부분 완료) – 민원인은 "홍길동"류 가짜 이름 + 010-0000-NNNN
    let n = 1500;
    let rows: Vec<ComplaintImport> = (0..n)
        .map(|i| {
            let received = at(i, n);
            let old = i < n - 60;
            let status = if old { if r.f() < 0.9 { "완료" } else { *r.pick(&["불가", "보류", "장기"]) } } else { *r.pick(&["접수", "진행", "답변", "진행"]) };
            let (area, place) = places[(i * 7919) % places.len()].clone();
            let ik = *r.pick(&intake);
            let done = if status == "완료" || status == "불가" { add_days(&received, r.int(2, 20)) } else { String::new() };
            from(json!({
                "intake": ik, "received": received, "ctype": r.pick(&ctype), "area": area, "place": place,
                "person": format!("홍길동{}", i % 50), "phone": phone(&mut r), "body": lines(&mut r, &what, 3, 5),
                "action": if old { lines(&mut r, &act, 3, 5) } else { lines(&mut r, &act, 1, 3) },
                "due": if ik == "국민신문고" || r.f() < 0.5 { add_days(&received, 14) } else { String::new() },
                "status": status, "done": done, "road": "", "memo": if r.f() < 0.3 { lines(&mut r, &more, 2, 2) } else { String::new() },
            }))
        })
        .collect();
    st.import_complaints(&rows, false).unwrap();

    // 할 일 6,000(목록 4)
    for nm in ["공사 감독", "예산"] {
        st.add_task_list(nm).unwrap();
    }
    let lists = st.tasks_data().unwrap().lists;
    let lid = |nm: &str| lists.iter().find(|l| l.name == nm).map(|l| l.id).unwrap();
    let ls = [lid("행정업무"), lid("공사 감독"), lid("예산")];
    let mut made = 0usize;
    while made < 6000 {
        let day = at(made, 6000);
        let old = day.as_str() < "2026-09-20";
        let list = *r.pick(&ls);
        let due = if r.f() < 0.8 { add_days(&day, r.int(1, 20)) } else { String::new() };
        let detail = if r.f() < 0.4 { lines(&mut r, &more, 1, 2) } else { String::new() };
        let top = st.add_task(&from(json!({ "list": list, "parent": null, "title": format!("{} {}", r.pick(&tt), made + 1), "detail": detail, "due": due }))).unwrap();
        made += 1;
        let mut k = r.int(0, 2);
        while k > 0 && made < 6000 {
            st.add_task(&from(json!({ "list": list, "parent": top.id, "title": format!("{} 하위 {}", r.pick(&tt), made + 1), "detail": "", "due": due }))).unwrap();
            made += 1;
            k -= 1;
        }
        if old {
            st.set_task_done(top.id, true, &add_days(&day, r.int(0, 10))).unwrap();
        }
    }

    // 업무일지(평일 8건 – 말 7 + 메모 1·표) · 일정(평일 2건 + 반복 10)
    let kinds = ["유선수신", "유선발신", "회의", "협의", "현장"];
    for date in &days {
        st.set_day(&from(json!({ "date": date, "arrive": "08:40", "transport": "", "weather": "", "note": "" }))).unwrap();
        for k in 0..7 {
            let c = &contacts[r.int(0, contacts.len() as i64 - 1) as usize];
            st.add_entry(&from(json!({
                "date": date, "time": format!("{:02}:{:02}", 9 + k, r.int(0, 59)), "kind": r.pick(&kinds), "who": c.name, "contact": c.mobile,
                "project": c.projects.first(), "lines": [{ "who": c.name, "me": false, "text": r.pick(&what) }, { "who": "나", "me": true, "text": r.pick(&act) }], "body": "",
            })))
            .unwrap();
        }
        st.add_entry(&from(json!({ "date": date, "time": "17:30", "kind": "메모", "who": "", "contact": "", "project": null, "lines": [],
            "body": format!("<p>{}</p><table><tr><td>구간</td><td>물량</td></tr><tr><td>1</td><td>2</td></tr></table>", r.pick(&act)) }))).unwrap();
    }
    let ek = ["업무 일정", "회의 · 협의", "출장"];
    let ev = |st: &Store, title: &str, kind: &str, date: &str, all: bool, t: &str, e: &str, rep: &str, until: &str| {
        st.add_event(&from(json!({ "title": title, "kind": kind, "date": date, "end": date, "allDay": all, "time": if all { "" } else { t },
            "endTime": if all { "" } else { e }, "repeat": rep, "until": until, "place": "", "desc": "", "remind": -1, "remindTime": "" }))).unwrap();
    };
    for date in &days {
        for _ in 0..2 {
            let all = r.f() < 0.3;
            let (t, k) = (r.pick(&tt).to_string(), r.pick(&ek).to_string());
            ev(&st, &t, &k, date, all, "10:00", "11:00", "", "");
        }
    }
    for k in 0..10 {
        ev(&st, &format!("주간회의 {k}"), "회의 · 협의", &format!("2024-01-0{}", k % 5 + 1), false, "09:00", "10:00", "weekly", "2027-12-31");
    }
    let cal = st.calendar_data().unwrap();
    let j = st.journal_data().unwrap();
    let t = st.tasks_data().unwrap();
    println!(
        "만듦 {:?}: 민원 {} · 연락처 {} · 할 일 {} · 업무일지 {} · 일정 {} · {:.1}초",
        dir,
        st.complaints().unwrap().len(),
        st.contacts_data().unwrap().contacts.len(),
        t.tasks.len(),
        j.entries.len(),
        cal.events.len(),
        t0.elapsed().as_secs_f64()
    );
}

fn bench(src: &Path, pw: &str) {
    let tmp = std::env::temp_dir().join(format!("gilog-bench-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    for f in ["gilog.db", "gilog.key.json"] {
        std::fs::copy(src.join(f), tmp.join(f)).unwrap();
    }
    let t = Instant::now();
    let mut st = Store::open(&tmp, pw).expect("열기");
    let open = t.elapsed();
    let t = Instant::now();
    let a = st.complaints_map().unwrap();
    let first = t.elapsed();
    let t = Instant::now();
    st.complaints_map().unwrap();
    let second = t.elapsed();
    let found = a.iter().filter(|c| c.x.is_some()).count();
    println!(
        "{{\"open_ms\": {:.1}, \"map_first_ms\": {:.1}, \"map_second_ms\": {:.1}, \"found\": {}, \"total\": {}}}",
        open.as_secs_f64() * 1000.0,
        first.as_secs_f64() * 1000.0,
        second.as_secs_f64() * 1000.0,
        found,
        a.len()
    );
    drop(st);
    let _ = std::fs::remove_dir_all(&tmp);
}

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if a.first().map(|s| s.as_str()) == Some("--bench") {
        bench(Path::new(&a[1]), a.get(2).map(|s| s.as_str()).unwrap_or("test"));
    } else {
        let dir = Path::new(a.first().expect("빈 폴더를 주세요"));
        std::fs::create_dir_all(dir).unwrap();
        make(dir, a.get(1).map(|s| s.as_str()).unwrap_or("test"));
    }
}
