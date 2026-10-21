// 지킴이 흉내 자료: 모든 화면이 비지 않게 조금씩 채워요(tools/align/seed.js + 집행현황·민원처리).
// 날짜는 shoot.py가 2026-10-21 10:00(서울)로 시계를 고정하는 것에 맞췄어요.
(() => {
  const seed = (f) => {
    f.password = "1234"; f.unlocked = true;
    f.prefs = { ...f.prefs, askPassword: false, theme: "light" };
    f.projects = [{ id: 1, name: "시도15호선", alias: "", color: null }, { id: 2, name: "방호벽 정비", alias: "", color: null }, { id: 3, name: "가을철 도로정비", alias: "", color: null }];
    f.nextProjectId = 4;
    f.contacts = [
      { id: 1, name: "박정호", org: "72사단", role: "시설장교", mobile: "010-1234-5678", tel: "031-940-1234", email: "", memo: "", projects: [2] },
      { id: 2, name: "김민수", org: "○○설계", role: "과장", mobile: "010-2222-3333", tel: "", email: "kim@ex.kr", memo: "", projects: [1, 3] },
      { id: 3, name: "이영희", org: "도로관리과", role: "주무관", mobile: "", tel: "031-940-5678", email: "", memo: "", projects: [] },
    ];
    f.nextId = 4;
    const d = "2026-10-21";
    f.days = [{ date: d, arrive: "08:40", transport: "", weather: "", note: "" }, { date: "2026-10-20", arrive: "", transport: "", weather: "", note: "" }];
    f.entries = [
      { id: 1, date: d, time: "09:10", kind: "유선수신", who: "박정호", contact: "010-1234-5678", project: 2, lines: [{ who: "박정호", me: false, text: "방호벽 현장 확인 일정 문의" }, { who: "나", me: true, text: "다음 주 화요일 가능해요" }], body: "" },
      { id: 2, date: d, time: "09:30", kind: "회의", who: "김민수", contact: "010-2222-3333", project: 1, lines: [{ who: "김민수", me: false, text: "설계 변경 검토 결과 공유" }], body: "" },
      { id: 3, date: "2026-10-20", time: "11:00", kind: "협의", who: "이영희", contact: "031-940-5678", project: 3, lines: [{ who: "이영희", me: false, text: "증빙자료 정리" }], body: "" },
    ];
    f.nextEntryId = 4;
    const c = (id, status, due, ctype, intake, received) => ({ id, no: id, intake, received, ctype, area: "조리읍", place: "봉일천리 113 일원", person: "홍길동", phone: "010-9999-0000", body: "도로 파손 보수 요청\n배수 확인", action: "현장 확인", due, status, memo: id === 2 ? '[{"t":"메모 내용"}]' : "" });
    f.complaints = [c(1, "접수", "2026-10-23", "포트홀", "전화", "2026-10-16"), c(2, "진행", "2026-10-20", "배수불량", "국민신문고", "2026-10-14"), c(3, "완료", "2026-10-10", "차선도색", "방문", "2026-10-02"), c(4, "보류", "", "기타", "진정민원", "2026-10-12")];
    f.nextComplaintId = 5;
    f.tasks = [
      { id: 1, list: 2, parent: null, title: "예산 요구서 작성", detail: "", due: "2026-10-21", done: false, doneOn: "" },
      { id: 2, list: 2, parent: 1, title: "증감 내역 정리", detail: "", due: "2026-10-23", done: false, doneOn: "" },
      { id: 3, list: 2, parent: null, title: "행정사무감사 자료", detail: "", due: "2026-10-30", done: false, doneOn: "" },
    ];
    f.nextTaskId = 4;
    f.events = [
      { id: 1, title: "방호벽 협의", kind: 2, date: "2026-10-21", end: "2026-10-21", allDay: false, time: "10:00", endTime: "11:00", repeat: "", until: "", place: "72사단", desc: "", remind: -1, remindTime: "" },
      { id: 2, title: "현장 출장", kind: 3, date: "2026-10-22", end: "2026-10-23", allDay: true, time: "", endTime: "", repeat: "", until: "", place: "", desc: "", remind: -1, remindTime: "" },
    ];
    f.nextEventId = 3;
    f.works = [{ id: 1, name: "소파보수", full: "2026 도로 소파보수 연간단가", co: "○○건설", contact: 1, project: null, scope: "포트홀·소파", nextSeq: 3, tpl: "" }];
    f.nextWorkId = 2;
    const pc = (no, place, summary, stage) => ({ no, received: "2026-10-20", due: "2026-10-27", area: "조리읍", place, summary, short: "소파보수", reason: "포트홀 사진", work: 1, note: "", seq: "", stage, complaint: null, photos: [], map: "", folder: "", orderFile: "", orderJpg: "", outboxFile: "", sentAt: "", road: "", order: null, item: 0 });
    f.cases = [pc("1AA-2610-0000123", "봉일천리 113", "도로 파임 보수 요청", "new"), pc("1AA-2610-0000456", "오산리 140-26", "포트홀 두 곳", "new")];
    f.values.set("bstatus:도로 유지관리", JSON.stringify({ sent: true, multi: false, from: 2026, to: 2026, sources: ["시비"], carry: "", carrySrc: "", rows: {} }));
  };
  // 집행현황 흉내는 api.ts보다 먼저 준비돼요 – 준비되는 그 순간 넣어야 화면이 처음 읽을 때 늘 같아요.
  let bf;
  Object.defineProperty(window, "__budgetFake", { configurable: true, get: () => bf, set: (x) => {
    bf = x;
    x.import(2026, [{ name: "도로 유지관리", budget: 500000000, carry: false, memo: "", items: [{ name: "도로포장 보수", budget: 300000000, memo: "", rows: [{ name: "포트홀 연간단가", kind: "공사", co: "○○건설", cmt: 120000000, exp: 80000000, act: 90000000, stage: "추진", memo: "" }] }] }]);
  } });
  let v;
  Object.defineProperty(window, "__fake", { configurable: true, get: () => v, set: (x) => { seed(x); v = x; } });
})();
