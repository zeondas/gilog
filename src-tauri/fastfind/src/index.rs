//! 드라이브 하나의 파일 목록(이름·부모·속성)과 이름 찾기.
//! 윈도우가 디스크에 갖고 있는 변경 기록(USN)을 읽어 채우고, 그 뒤 바뀐 기록으로 맞춰요.
//! 이 파일은 윈도우가 아니어도 돌아가요(시험은 리눅스에서).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// 파일 번호의 아래 48비트(위 16비트는 재사용 번호라 부모 번호와 어긋날 수 있어 떼요)
pub const FRN_MASK: u64 = 0x0000_FFFF_FFFF_FFFF;
/// NTFS 드라이브 맨 위 폴더의 파일 번호
pub const ROOT_FRN: u64 = 5;

pub const ATTR_HIDDEN: u32 = 0x2;
pub const ATTR_SYSTEM: u32 = 0x4;
pub const ATTR_DIRECTORY: u32 = 0x10;

pub const REASON_FILE_DELETE: u32 = 0x0000_0200;
pub const REASON_RENAME_OLD_NAME: u32 = 0x0000_1000;
pub const REASON_RENAME_NEW_NAME: u32 = 0x0000_2000;

#[derive(Clone, Debug)]
struct Node {
    parent: u64,
    attrs: u32,
    name: Box<str>,
}

/// 변경 기록 한 줄(필요한 칸만)
#[derive(Clone, Debug, PartialEq)]
pub struct UsnRec {
    pub frn: u64,
    pub parent: u64,
    pub reason: u32,
    pub attrs: u32,
    pub name: String,
}

fn u16le(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u32le(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn u64le(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}

/// USN_RECORD_V2·V3가 이어 붙은 바이트를 읽어요(앞의 8바이트 "다음 번호"는 떼고 넘겨요).
pub fn parse_records(buf: &[u8]) -> Vec<UsnRec> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + 8 <= buf.len() {
        let Some(len) = u32le(buf, off).map(|l| l as usize) else { break };
        if len < 8 || off + len > buf.len() {
            break;
        }
        let rec = &buf[off..off + len];
        let major = u16le(rec, 4).unwrap_or(0);
        // (파일 번호, 부모 번호, 까닭, 속성, 이름 길이, 이름 자리) 칸 위치
        let at = match major {
            2 => Some((8, 16, 40, 52, 56, 58)),
            3 => Some((8, 24, 56, 68, 72, 74)), // 128비트 번호 — 아래 64비트만 써요
            _ => None,
        };
        if let Some((f, p, r, a, nl, no)) = at {
            if let (Some(frn), Some(parent), Some(reason), Some(attrs), Some(nlen), Some(noff)) =
                (u64le(rec, f), u64le(rec, p), u32le(rec, r), u32le(rec, a), u16le(rec, nl), u16le(rec, no))
            {
                let (s, e) = (noff as usize, noff as usize + nlen as usize);
                if let Some(nb) = rec.get(s..e) {
                    let w: Vec<u16> = nb.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                    out.push(UsnRec { frn, parent, reason, attrs, name: String::from_utf16_lossy(&w) });
                }
            }
        }
        off += len;
    }
    out
}

/// 찾기 조건
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub struct Query {
    /// "*.jpg;*.png" 또는 이름 일부(앱의 찾기 칸과 같은 규칙), 비면 모두
    #[serde(default)]
    pub name: String,
    /// 이 폴더들 아래만(비면 모든 드라이브)
    #[serde(default)]
    pub roots: Vec<String>,
    /// roots 아래 하위 폴더까지
    #[serde(default = "yes")]
    pub sub: bool,
    /// 숨김·시스템 파일도
    #[serde(default)]
    pub hidden: bool,
    /// 폴더도 결과에
    #[serde(default = "yes")]
    pub dirs: bool,
    #[serde(default = "limit")]
    pub limit: usize,
}
fn yes() -> bool {
    true
}
fn limit() -> usize {
    5000
}

/// 찾은 것 하나
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Hit {
    /// 전체 경로
    pub p: String,
    /// 폴더인지
    pub d: bool,
}

/// 이름 맞추기 — 앱(files.rs `name_matches`)과 같은 규칙: ;로 여러 개, *·?가 있으면 무늬, 없으면 들어 있는지. 대소문자 무시.
pub struct Matcher {
    pats: Vec<(bool, String, Vec<char>)>,
    buf: String,
    chars: Vec<char>,
}

impl Matcher {
    pub fn new(pattern: &str) -> Self {
        let pats = pattern
            .split(';')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(|p| {
                let l = p.to_lowercase();
                let g = l.contains('*') || l.contains('?');
                let c = l.chars().collect();
                (g, l, c)
            })
            .collect();
        Matcher { pats, buf: String::new(), chars: Vec::new() }
    }
    pub fn all(&self) -> bool {
        self.pats.is_empty()
    }
    pub fn is_match(&mut self, name: &str) -> bool {
        if self.pats.is_empty() {
            return true;
        }
        self.buf.clear();
        if name.is_ascii() {
            self.buf.extend(name.bytes().map(|b| b.to_ascii_lowercase() as char));
        } else {
            for c in name.chars() {
                self.buf.extend(c.to_lowercase());
            }
        }
        let mut need_chars = true;
        for (g, l, pc) in &self.pats {
            if *g {
                if need_chars {
                    self.chars.clear();
                    self.chars.extend(self.buf.chars());
                    need_chars = false;
                }
                if glob(pc, &self.chars) {
                    return true;
                }
            } else if self.buf.contains(l.as_str()) {
                return true;
            }
        }
        false
    }
}

fn glob(p: &[char], s: &[char]) -> bool {
    let (mut i, mut j, mut star, mut mark) = (0usize, 0usize, None::<usize>, 0usize);
    while j < s.len() {
        if i < p.len() && (p[i] == '?' || p[i] == s[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(st) = star {
            i = st + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == '*' {
        i += 1;
    }
    i == p.len()
}

/// 목록에서 빼는 드라이브 맨 위 폴더(2026-10-20 사용자 2안 — 업무 파일이 없는 시스템 폴더, 메모리 줄이기)
pub const SKIP_TOP: [&str; 9] = ["windows", "windows.old", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "recovery", "perflogs"];

/// 경로가 목록에서 뺀 곳 아래인지("C:\\Windows\\…", "D:\\Users\\홍길동\\AppData\\…") — 앱도 같은 규칙으로 예전 찾기로 돌려요
pub fn is_skipped_path(path: &str) -> bool {
    let p = path.replace('/', "\\").to_lowercase();
    let parts: Vec<&str> = p.split('\\').filter(|x| !x.is_empty()).collect();
    if parts.len() >= 2 && SKIP_TOP.contains(&parts[1]) {
        return true;
    }
    parts.len() >= 4 && parts[1] == "users" && parts[3] == "appdata"
}

/// 드라이브 하나의 목록
pub struct Volume {
    /// "C:"
    pub drive: String,
    nodes: HashMap<u64, Node>,
    /// 목록에서 뺀 폴더(그 아래로 새로 생기는 것도 넣지 않아요)
    skip: HashSet<u64>,
}

impl Volume {
    pub fn new(drive: &str) -> Self {
        Volume { drive: drive.to_string(), nodes: HashMap::new(), skip: HashSet::new() }
    }
    pub fn len(&self) -> usize {
        self.nodes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// 처음 읽기·변경 기록 한 줄 넣기
    pub fn apply(&mut self, r: &UsnRec) {
        let frn = r.frn & FRN_MASK;
        if r.reason & REASON_FILE_DELETE != 0 {
            self.nodes.remove(&frn);
            self.skip.remove(&frn);
            return;
        }
        // 이름 바꾸기의 옛 이름 기록은 새 이름 기록이 곧 와요
        if r.reason & REASON_RENAME_OLD_NAME != 0 && r.reason & REASON_RENAME_NEW_NAME == 0 {
            return;
        }
        if frn == ROOT_FRN {
            return;
        }
        let parent = r.parent & FRN_MASK;
        let dir = r.attrs & ATTR_DIRECTORY != 0;
        // 뺀 폴더 아래(또는 뺄 폴더 자신)는 넣지 않아요 — 폴더면 기억해 그 아래도 빼요
        if self.skip.contains(&parent) || (dir && self.is_skip_dir(parent, &r.name)) {
            self.nodes.remove(&frn);
            if dir {
                self.skip.insert(frn);
            }
            return;
        }
        self.skip.remove(&frn);
        self.nodes.insert(frn, Node { parent, attrs: r.attrs, name: r.name.as_str().into() });
    }

    /// parent 아래 name 폴더가 뺄 폴더인지(드라이브 맨 위 시스템 폴더, 사용자\\…\\AppData)
    fn is_skip_dir(&self, parent: u64, name: &str) -> bool {
        let l = name.to_lowercase();
        if parent == ROOT_FRN {
            return SKIP_TOP.contains(&l.as_str());
        }
        if l != "appdata" {
            return false;
        }
        let Some(user) = self.nodes.get(&parent) else { return false };
        let Some(users) = self.nodes.get(&user.parent) else { return false };
        users.parent == ROOT_FRN && users.name.eq_ignore_ascii_case("users")
    }

    /// 처음 읽은 뒤 한 번: 뺄 폴더와 그 아래를 목록에서 덜어 내요(메모리 줄이기)
    pub fn prune(&mut self) {
        let mut memo: HashMap<u64, bool> = HashMap::new();
        let keys: Vec<u64> = self.nodes.keys().copied().collect();
        for k in &keys {
            self.skipped(*k, &mut memo);
        }
        for (k, out) in memo {
            if out {
                if let Some(n) = self.nodes.remove(&k) {
                    if n.attrs & ATTR_DIRECTORY != 0 {
                        self.skip.insert(k);
                    }
                }
            }
        }
        self.nodes.shrink_to_fit();
    }

    /// 이 항목이 뺄 곳에 있는지(자신이 뺄 폴더이거나 그 아래)
    fn skipped(&self, frn: u64, memo: &mut HashMap<u64, bool>) -> bool {
        let mut chain = Vec::new();
        let mut cur = frn;
        let mut res = false;
        for _ in 0..512 {
            if let Some(&m) = memo.get(&cur) {
                res = m;
                break;
            }
            let Some(n) = self.nodes.get(&cur) else { break };
            chain.push(cur);
            if self.skip.contains(&n.parent) || (n.attrs & ATTR_DIRECTORY != 0 && self.is_skip_dir(n.parent, &n.name)) {
                res = true;
                break;
            }
            if n.parent == ROOT_FRN {
                break;
            }
            cur = n.parent;
        }
        for c in chain {
            memo.insert(c, res);
        }
        res
    }

    /// 폴더 하나의 전체 경로와 그 위에 숨김 폴더가 있는지(알 수 없는 부모면 None — 드라이브 관리용 파일 등)
    fn dir_path(&self, frn: u64, cache: &mut HashMap<u64, Option<(String, bool)>>) -> Option<(String, bool)> {
        if frn == ROOT_FRN {
            return Some((format!("{}\\", self.drive), false));
        }
        if let Some(c) = cache.get(&frn) {
            return c.clone();
        }
        // 맨 위까지 올라가며 모은 뒤 위에서부터 붙여요(깊이 제한으로 고리를 막아요)
        let mut chain: Vec<u64> = Vec::new();
        let mut cur = frn;
        let mut base: Option<(String, bool)> = None;
        for _ in 0..512 {
            if cur == ROOT_FRN {
                base = Some((format!("{}\\", self.drive), false));
                break;
            }
            if let Some(c) = cache.get(&cur) {
                base = c.clone();
                if base.is_none() {
                    break;
                }
                break;
            }
            let Some(n) = self.nodes.get(&cur) else { break };
            chain.push(cur);
            cur = n.parent;
        }
        let Some((mut path, mut hid)) = base else {
            for c in chain {
                cache.insert(c, None);
            }
            return None;
        };
        for c in chain.into_iter().rev() {
            let n = &self.nodes[&c];
            if !path.ends_with('\\') {
                path.push('\\');
            }
            path.push_str(&n.name);
            hid |= n.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0;
            cache.insert(c, Some((path.clone(), hid)));
        }
        Some((path, hid))
    }

    /// 조건에 맞는 것을 out에 더해요(limit까지). 더 있으면 true.
    pub fn query(&self, q: &Query, m: &mut Matcher, roots: &[String], out: &mut Vec<Hit>) -> bool {
        let mut cache: HashMap<u64, Option<(String, bool)>> = HashMap::new();
        // 이 드라이브에 걸리는 폴더만(소문자, 끝에 \)
        let mine: Vec<&String> = roots.iter().filter(|r| r.get(..2).map(|d| d.eq_ignore_ascii_case(&self.drive)).unwrap_or(false)).collect();
        if !roots.is_empty() && mine.is_empty() {
            return false;
        }
        for n in self.nodes.values() {
            let dir = n.attrs & ATTR_DIRECTORY != 0;
            if dir && !q.dirs {
                continue;
            }
            if !q.hidden && n.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0 {
                continue;
            }
            if n.name.starts_with('$') && n.parent == ROOT_FRN {
                continue; // 드라이브 관리용($Recycle.Bin 등)
            }
            if !m.is_match(&n.name) {
                continue;
            }
            let Some((parent, hid)) = self.dir_path(n.parent, &mut cache) else { continue };
            if hid && !q.hidden {
                continue;
            }
            if !mine.is_empty() {
                let pl = parent.to_lowercase();
                let pl = if pl.ends_with('\\') { pl } else { pl + "\\" };
                let inside = mine.iter().any(|r| if q.sub { pl.starts_with(r.as_str()) } else { pl == **r });
                if !inside {
                    continue;
                }
            }
            if out.len() >= q.limit {
                return true;
            }
            let p = if parent.ends_with('\\') { format!("{parent}{}", n.name) } else { format!("{parent}\\{}", n.name) };
            out.push(Hit { p, d: dir });
        }
        false
    }
}

/// roots를 비교하기 좋게(소문자, 끝에 \)
pub fn norm_roots(roots: &[String]) -> Vec<String> {
    roots
        .iter()
        .map(|r| r.trim().replace('/', "\\").to_lowercase())
        .filter(|r| r.len() >= 2)
        .map(|r| if r.ends_with('\\') { r } else { r + "\\" })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec2(frn: u64, parent: u64, reason: u32, attrs: u32, name: &str) -> Vec<u8> {
        let w: Vec<u16> = name.encode_utf16().collect();
        let len = (60 + w.len() * 2 + 7) / 8 * 8;
        let mut b = vec![0u8; len];
        b[0..4].copy_from_slice(&(len as u32).to_le_bytes());
        b[4..6].copy_from_slice(&2u16.to_le_bytes());
        b[8..16].copy_from_slice(&frn.to_le_bytes());
        b[16..24].copy_from_slice(&parent.to_le_bytes());
        b[40..44].copy_from_slice(&reason.to_le_bytes());
        b[52..56].copy_from_slice(&attrs.to_le_bytes());
        b[56..58].copy_from_slice(&((w.len() * 2) as u16).to_le_bytes());
        b[58..60].copy_from_slice(&60u16.to_le_bytes());
        for (i, c) in w.iter().enumerate() {
            b[60 + i * 2..62 + i * 2].copy_from_slice(&c.to_le_bytes());
        }
        b
    }

    fn vol() -> Volume {
        let seq = 3u64 << 48; // 재사용 번호가 붙어도 같은 것으로
        let mut buf = Vec::new();
        buf.extend(rec2(100 | seq, ROOT_FRN | seq, 0, ATTR_DIRECTORY, "민원처리"));
        buf.extend(rec2(101, 100, 0, 0x20, "261015_봉일천리 209-10_포트홀.pptx"));
        buf.extend(rec2(102, 100, 0, 0x20, "261015_봉일천리 209-10_포트홀_사진1.JPG"));
        buf.extend(rec2(103, ROOT_FRN, 0, ATTR_DIRECTORY | ATTR_HIDDEN, "숨김"));
        buf.extend(rec2(104, 103, 0, 0x20, "포트홀 숨김.txt"));
        buf.extend(rec2(105, 999, 0, 0x20, "포트홀 고아.txt")); // 부모를 모름
        buf.extend(rec2(106, 100, 0, ATTR_DIRECTORY, "포트홀 사진"));
        let mut v = Volume::new("D:");
        for r in parse_records(&buf) {
            v.apply(&r);
        }
        v
    }

    fn find(v: &Volume, q: Query) -> Vec<String> {
        let mut m = Matcher::new(&q.name);
        let roots = norm_roots(&q.roots);
        let mut out = Vec::new();
        v.query(&q, &mut m, &roots, &mut out);
        let mut p: Vec<String> = out.into_iter().map(|h| h.p).collect();
        p.sort();
        p
    }

    #[test]
    fn parse_v2_and_v3() {
        let b = rec2(7, 5, REASON_FILE_DELETE, 0x20, "가.txt");
        let r = parse_records(&b);
        assert_eq!(r, vec![UsnRec { frn: 7, parent: 5, reason: REASON_FILE_DELETE, attrs: 0x20, name: "가.txt".into() }]);
        // V3: 번호 128비트
        let w: Vec<u16> = "나.jpg".encode_utf16().collect();
        let len = (76 + w.len() * 2 + 7) / 8 * 8;
        let mut v3 = vec![0u8; len];
        v3[0..4].copy_from_slice(&(len as u32).to_le_bytes());
        v3[4..6].copy_from_slice(&3u16.to_le_bytes());
        v3[8..16].copy_from_slice(&9u64.to_le_bytes());
        v3[24..32].copy_from_slice(&5u64.to_le_bytes());
        v3[68..72].copy_from_slice(&0x10u32.to_le_bytes());
        v3[72..74].copy_from_slice(&((w.len() * 2) as u16).to_le_bytes());
        v3[74..76].copy_from_slice(&76u16.to_le_bytes());
        for (i, c) in w.iter().enumerate() {
            v3[76 + i * 2..78 + i * 2].copy_from_slice(&c.to_le_bytes());
        }
        let r = parse_records(&[b.clone(), v3].concat());
        assert_eq!(r.len(), 2);
        assert_eq!((r[1].frn, r[1].parent, r[1].attrs, r[1].name.as_str()), (9, 5, 0x10, "나.jpg"));
        // 잘린 끝은 버려요
        assert_eq!(parse_records(&b[..b.len() - 4]).len(), 0);
    }

    #[test]
    fn names_paths_and_hidden() {
        let v = vol();
        assert_eq!(
            find(&v, Query { name: "포트홀".into(), sub: true, dirs: true, limit: 100, ..Default::default() }),
            vec!["D:\\민원처리\\261015_봉일천리 209-10_포트홀.pptx", "D:\\민원처리\\261015_봉일천리 209-10_포트홀_사진1.JPG", "D:\\민원처리\\포트홀 사진"]
        );
        // 무늬·대소문자
        assert_eq!(find(&v, Query { name: "*.jpg".into(), sub: true, dirs: true, limit: 100, ..Default::default() }).len(), 1);
        // 숨김 폴더 아래도 hidden이면 보여요
        let all = find(&v, Query { name: "숨김".into(), sub: true, dirs: true, hidden: true, limit: 100, ..Default::default() });
        assert_eq!(all, vec!["D:\\숨김", "D:\\숨김\\포트홀 숨김.txt"]);
        // 폴더 빼기
        assert_eq!(find(&v, Query { name: "포트홀".into(), sub: true, dirs: false, limit: 100, ..Default::default() }).len(), 2);
    }

    #[test]
    fn roots_and_limit_and_changes() {
        let mut v = vol();
        let q = |name: &str, roots: &[&str], sub: bool| Query { name: name.into(), roots: roots.iter().map(|s| s.to_string()).collect(), sub, dirs: true, limit: 100, ..Default::default() };
        assert_eq!(find(&v, q("포트홀", &["D:\\민원처리"], true)).len(), 3);
        assert_eq!(find(&v, q("포트홀", &["C:\\"], true)).len(), 0);
        assert_eq!(find(&v, q("", &["d:\\"], false)), vec!["D:\\민원처리"]);
        // 한도
        let mut m = Matcher::new("");
        let mut out = Vec::new();
        assert!(v.query(&Query { limit: 2, sub: true, dirs: true, ..Default::default() }, &mut m, &[], &mut out));
        assert_eq!(out.len(), 2);
        // 이름 바꾸기(옛 이름은 무시, 새 이름 반영)·지우기
        v.apply(&UsnRec { frn: 101, parent: 100, reason: REASON_RENAME_OLD_NAME, attrs: 0x20, name: "옛.pptx".into() });
        v.apply(&UsnRec { frn: 101, parent: 100, reason: REASON_RENAME_NEW_NAME, attrs: 0x20, name: "새 이름.pptx".into() });
        v.apply(&UsnRec { frn: 102, parent: 100, reason: REASON_FILE_DELETE, attrs: 0x20, name: String::new() });
        assert_eq!(find(&v, q("이름", &[], true)), vec!["D:\\민원처리\\새 이름.pptx"]);
        assert_eq!(find(&v, q("사진1", &[], true)).len(), 0);
        // 폴더 이름이 바뀌면 안의 파일 경로도 따라가요
        v.apply(&UsnRec { frn: 100, parent: ROOT_FRN, reason: REASON_RENAME_NEW_NAME, attrs: ATTR_DIRECTORY, name: "민원".into() });
        assert_eq!(find(&v, q("새 이름", &[], true)), vec!["D:\\민원\\새 이름.pptx"]);
    }

    #[test]
    fn system_folders_left_out() {
        let mut v = Volume::new("C:");
        let d = ATTR_DIRECTORY;
        for (frn, parent, attrs, name) in [
            (10, ROOT_FRN, d, "Windows"),
            (11, 10, d, "System32"),
            (12, 11, 0x20, "포트홀.dll"),
            (20, ROOT_FRN, d, "Users"),
            (21, 20, d, "홍길동"),
            (22, 21, d, "AppData"),
            (23, 22, 0x20, "포트홀 캐시.tmp"),
            (24, 21, d, "Documents"),
            (25, 24, 0x20, "포트홀 보고.hwp"),
        ]
        .into_iter()
        .rev()
        {
            // 처음 읽기는 순서가 뒤섞여 와요 — 아래 것이 먼저 오면 그때는 못 빼고 prune이 덜어 내요
            v.apply(&UsnRec { frn, parent, reason: 0, attrs, name: name.into() });
        }
        assert!(v.len() > 4);
        v.prune();
        assert_eq!(find(&v, Query { name: "포트홀".into(), sub: true, dirs: true, limit: 100, ..Default::default() }), vec!["C:\\Users\\홍길동\\Documents\\포트홀 보고.hwp"]);
        assert_eq!(v.len(), 4, "Users·홍길동·Documents·보고만 남아요");
        // 그 뒤 생기는 것도 빼요(뺀 폴더 아래 새 폴더·파일, 새로 만든 AppData)
        v.apply(&UsnRec { frn: 30, parent: 11, reason: 0, attrs: d, name: "새 폴더".into() });
        v.apply(&UsnRec { frn: 31, parent: 30, reason: 0, attrs: 0x20, name: "포트홀2.txt".into() });
        v.apply(&UsnRec { frn: 40, parent: ROOT_FRN, reason: 0, attrs: d, name: "ProgramData".into() });
        v.apply(&UsnRec { frn: 41, parent: 40, reason: 0, attrs: 0x20, name: "포트홀3.txt".into() });
        v.apply(&UsnRec { frn: 50, parent: 24, reason: 0, attrs: 0x20, name: "포트홀4.txt".into() });
        assert_eq!(find(&v, Query { name: "포트홀".into(), sub: true, dirs: true, limit: 100, ..Default::default() }).len(), 2);
        assert!(is_skipped_path("C:\\Windows\\System32"));
        assert!(is_skipped_path("d:/users/홍길동/appdata/local"));
        assert!(!is_skipped_path("C:\\Users\\홍길동\\Documents"));
        assert!(!is_skipped_path("D:\\민원처리\\Windows"));
    }

    #[test]
    fn matcher_same_as_app() {
        let mut m = Matcher::new("*.JPG; 봉일천");
        assert!(m.is_match("a.jpg"));
        assert!(m.is_match("261015_봉일천리.pptx"));
        assert!(!m.is_match("a.png"));
        let mut m = Matcher::new("26??15*");
        assert!(m.is_match("261015_x"));
        assert!(!m.is_match("x261015"));
        assert!(Matcher::new(" ; ").all());
    }
}
