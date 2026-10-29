// 지킴이 시험 자료: 모든 화면이 비지 않게 조금씩 채워요(tools/align/seed.js + 집행현황·민원처리).
// 날짜는 shoot.py가 2026-10-21 10:00(서울)로 시계를 고정하는 것에 맞췄어요.
// 2026-10-30 ②-3 2차: 흉내 저장소에 값을 직접 넣던 것을, 앱과 같은 명령을 같은 순서로 불러 채워요(규칙은 core가 정해요 –
// 연번·번호·정리는 실제 앱과 같아요). 미리 보기 저장 모듈이 준비되면 화면이 처음 부르기 전에 한 번 불려요(tools/preview/core.ts).
window.__previewSeed = async (call) => {
  call("create_store", { password: "1234" });
  call("set_prefs", { prefs: { ...call("get_prefs"), askPassword: false, theme: "light" } });

  for (const name of ["시도15호선", "방호벽 정비", "가을철 도로정비"]) call("add_project", { name });
  const contact = (name, org, role, mobile, tel, email, projects) => call("add_contact", { contact: { name, org, role, mobile, tel, email, projects } });
  contact("박정호", "72사단", "시설장교", "010-1234-5678", "031-940-1234", "", ["방호벽 정비"]);
  contact("김민수", "○○설계", "과장", "010-2222-3333", "", "kim@ex.kr", ["시도15호선", "가을철 도로정비"]);
  contact("이영희", "도로관리과", "주무관", "", "031-940-5678", "", []);
  const pj = Object.fromEntries(call("contacts_data").projects.map((p) => [p.name, p.id]));

  const d = "2026-10-21";
  call("set_journal_day", { day: { date: d, arrive: "08:40", transport: "", weather: "", note: "" } });
  call("set_journal_day", { day: { date: "2026-10-20", arrive: "", transport: "", weather: "", note: "" } });
  const entry = (date, time, kind, who, contact, project, lines) => call("add_journal_entry", { entry: { date, time, kind, who, contact, project, lines, body: "" } });
  entry(d, "09:10", "유선수신", "박정호", "010-1234-5678", pj["방호벽 정비"], [{ who: "박정호", me: false, text: "방호벽 현장 확인 일정 문의" }, { who: "나", me: true, text: "다음 주 화요일 가능해요" }]);
  entry(d, "09:30", "회의", "김민수", "010-2222-3333", pj["시도15호선"], [{ who: "김민수", me: false, text: "설계 변경 검토 결과 공유" }]);
  entry("2026-10-20", "11:00", "협의", "이영희", "031-940-5678", pj["가을철 도로정비"], [{ who: "이영희", me: false, text: "증빙자료 정리" }]);

  const complaint = (status, due, ctype, intake, received, memo) => {
    const c = call("add_complaint", { complaint: { intake, received, ctype, area: "조리읍", place: "봉일천리 113 일원", person: "홍길동", phone: "010-9999-0000", body: "도로 파손 보수 요청\n배수 확인", action: "현장 확인", due, status } });
    if (memo) call("set_complaint_memo", { id: c.id, memo });
  };
  complaint("접수", "2026-10-23", "포트홀", "전화", "2026-10-16");
  complaint("진행", "2026-10-20", "배수불량", "국민신문고", "2026-10-14", '[{"t":"메모 내용"}]');
  complaint("완료", "2026-10-10", "차선도색", "방문", "2026-10-02");
  complaint("보류", "", "기타", "진정민원", "2026-10-12");

  const lists = call("tasks_data").lists;
  const admin = (lists.find((l) => l.name === "행정업무") ?? call("add_task_list", { name: "행정업무" })).id;
  const task = (title, due, parent = null) => call("add_task", { task: { list: admin, parent, title, detail: "", due } });
  const t1 = task("예산 요구서 작성", "2026-10-21");
  task("증감 내역 정리", "2026-10-23", t1.id);
  task("행정사무감사 자료", "2026-10-30");

  const ev = (title, kind, date, end, allDay, time, endTime, place) =>
    call("add_event", { event: { title, kind, date, end, allDay, time, endTime, repeat: "", until: "", place, desc: "", remind: -1, remindTime: "" } });
  ev("방호벽 협의", "회의 · 협의", "2026-10-21", "2026-10-21", false, "10:00", "11:00", "72사단");
  ev("현장 출장", "출장", "2026-10-22", "2026-10-23", true, "", "", "");

  const parkId = call("contacts_data").contacts.find((c) => c.name === "박정호").id;
  const work = call("save_work", { id: null, work: { name: "소파보수", full: "2026 도로 소파보수 연간단가", co: "○○건설", contact: parkId, project: null, scope: "포트홀·소파", nextSeq: 3, tpl: "" } })[0].id;
  const pc = (no, place, summary) => ({ no, received: "2026-10-20", due: "2026-10-27", area: "조리읍", place, summary, short: "소파보수", reason: "포트홀 사진", work, photos: [], map: "" });
  call("preview_inbox", { list: [pc("1AA-2610-0000123", "봉일천리 113", "도로 파임 보수 요청"), pc("1AA-2610-0000456", "오산리 140-26", "포트홀 두 곳")], ready: true });
  call("read_inbox", { inbox: "", downloads: "", root: "", hold: false });

  call("import_budget", {
    year: 2026,
    projects: [{ name: "도로 유지관리", budget: 500000000, carry: false, memo: "", items: [{ name: "도로포장 보수", budget: 300000000, memo: "", rows: [{ name: "포트홀 연간단가", kind: "공사", co: "○○건설", cmt: 120000000, exp: 80000000, act: 90000000, stage: "추진", memo: "" }] }] }],
  });
  call("bstatus_set", { name: "도로 유지관리", setup: JSON.stringify({ sent: true, multi: false, from: 2026, to: 2026, sources: ["시비"], carry: "", carrySrc: "", rows: {} }) });
};

// ---------- 옛 기준 빌드(②-3 2차 전 main – api.ts 흉내)용 ----------
// 지킴이는 기준(main)과 이 가지를 같은 seed.js로 찍어요. 기준이 아직 흉내를 쓰면 예전처럼 흉내 저장소에 바로 넣어요.
// 기준 main도 미리 보기 저장 모듈을 쓰게 되면(이 가지가 합쳐진 뒤) 필요 없어요 – 3차(`wip/core-wasm3`)에서 지워요.
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
