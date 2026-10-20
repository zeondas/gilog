//! 드라이브 목록들을 함께 들고 물음에 답해요(윈도우가 아니어도 돌아가 시험해요).

use std::sync::RwLock;

use crate::index::{norm_roots, Matcher, Volume};
use crate::{DriveState, Request, Response, VERSION};

pub struct Slot {
    pub vol: Volume,
    pub ready: bool,
}

pub struct Shared {
    pub slots: Vec<RwLock<Slot>>,
}

/// 한 번에 돌려줄 수 있는 가장 많은 수(앱은 5,000개까지 보여요 — 조건으로 거를 몫을 더해)
pub const MAX_LIMIT: usize = 50_000;

impl Shared {
    pub fn new(drives: &[String]) -> Self {
        Shared { slots: drives.iter().map(|d| RwLock::new(Slot { vol: Volume::new(d), ready: false })).collect() }
    }

    pub fn answer(&self, line: &str) -> Response {
        let req: Request = match serde_json::from_str(line.trim()) {
            Ok(r) => r,
            Err(e) => return Response::Error { error: format!("bad_request:{e}") },
        };
        match req {
            Request::Status => Response::Status {
                version: VERSION,
                drives: self
                    .slots
                    .iter()
                    .map(|s| {
                        let s = s.read().unwrap_or_else(|e| e.into_inner());
                        DriveState { drive: s.vol.drive.clone(), count: s.vol.len(), ready: s.ready }
                    })
                    .collect(),
            },
            Request::Find(mut q) => {
                q.limit = q.limit.clamp(1, MAX_LIMIT);
                // 긴 무늬가 수많은 이름에 걸리면 오래 걸려요 — 글자 260자, ; 묶음 16개까지
                if q.name.chars().count() > 260 || q.name.split(';').count() > 16 || q.roots.len() > 64 {
                    return Response::Error { error: "too_long".into() };
                }
                let roots = norm_roots(&q.roots);
                let mut m = Matcher::new(&q.name);
                let mut hits = Vec::new();
                let mut more = false;
                for s in &self.slots {
                    let s = s.read().unwrap_or_else(|e| e.into_inner());
                    if !s.ready {
                        continue;
                    }
                    if s.vol.query(&q, &mut m, &roots, &mut hits) {
                        more = true;
                        break;
                    }
                }
                Response::Find { hits, more }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{UsnRec, ATTR_DIRECTORY, ROOT_FRN};

    #[test]
    fn status_and_find_json() {
        let sh = Shared::new(&["C:".into(), "D:".into()]);
        {
            let mut d = sh.slots[1].write().unwrap();
            d.vol.apply(&UsnRec { frn: 50, parent: ROOT_FRN, reason: 0, attrs: ATTR_DIRECTORY, name: "공사".into() });
            d.vol.apply(&UsnRec { frn: 51, parent: 50, reason: 0, attrs: 0x20, name: "포트홀.hwp".into() });
            d.ready = true;
        }
        let s = serde_json::to_string(&sh.answer(r#"{"op":"status"}"#)).unwrap();
        assert!(s.contains(r#""drive":"C:","count":0,"ready":false"#), "{s}");
        assert!(s.contains(r#""drive":"D:","count":2,"ready":true"#), "{s}");
        let f = serde_json::to_string(&sh.answer(r#"{"op":"find","name":"포트홀"}"#)).unwrap();
        assert_eq!(f, r#"{"hits":[{"p":"D:\\공사\\포트홀.hwp","d":false}],"more":false}"#);
        let e = serde_json::to_string(&sh.answer("엉뚱한 말")).unwrap();
        assert!(e.contains("bad_request"));
    }
}
