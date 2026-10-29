// 글자 맞춤 재기 자료(census.py·ruler.py·topbar*.py) – 모든 화면이 비지 않게 조금씩 채워요.
// 2026-10-30 ②-3 3차: 흉내 저장소에 값을 직접 넣던 것을 지킴이 seed처럼 앱과 같은 명령으로 채워요(tools/preview/core.ts가
// 화면이 처음 부르기 전에 한 번 불러요). 도구들이 아래 `theme: "light"`를 바꿔 끼워 어둡게도 재요 – 이 글자를 지우지 마세요.
window.__previewSeed = async (call) => {
  call("create_store", { password: "1234" });
  call("set_prefs", { prefs: { ...call("get_prefs"), askPassword: false, theme: "light" } });

  for (const name of ["시도15호선", "방호벽 정비", "가을철 도로정비"]) call("add_project", { name });
  const contact = (name, org, role, mobile, tel, email, projects) => call("add_contact", { contact: { name, org, role, mobile, tel, email, projects } });
  contact("박정호", "72사단", "시설장교", "010-1234-5678", "031-940-1234", "", ["방호벽 정비"]);
  contact("김민수", "○○설계", "과장", "010-2222-3333", "", "kim@ex.kr", ["시도15호선", "가을철 도로정비"]);
  contact("이영희", "도로관리과", "주무관", "", "031-940-5678", "", []);
  const pj = Object.fromEntries(call("contacts_data").projects.map((p) => [p.name, p.id]));

  const d = "2026-10-16";
  call("set_journal_day", { day: { date: d, arrive: "08:40", transport: "", weather: "", note: "" } });
  call("set_journal_day", { day: { date: "2026-10-15", arrive: "", transport: "", weather: "", note: "" } });
  const entry = (date, time, kind, who, contact, project, lines, body = "") => call("add_journal_entry", { entry: { date, time, kind, who, contact, project, lines, body } });
  entry(d, "09:10", "유선수신", "박정호", "010-1234-5678", pj["방호벽 정비"], [{ who: "박정호", me: false, text: "방호벽 현장 확인 일정 문의" }, { who: "나", me: true, text: "다음 주 화요일 가능해요" }]);
  entry(d, "10:30", "회의", "김민수", "010-2222-3333", pj["시도15호선"], [{ who: "김민수", me: false, text: "설계 변경 검토 결과 공유" }]);
  entry(d, "14:00", "메모", "", "", null, [], "<p>오후 현장 점검</p>");
  entry("2026-10-15", "11:00", "협의", "이영희", "031-940-5678", pj["가을철 도로정비"], [{ who: "이영희", me: false, text: "증빙자료 정리" }]);

  const complaint = (received, status, due, ctype, intake, memo) => {
    const c = call("add_complaint", { complaint: { intake, received, ctype, area: "조리읍", place: "봉일천리 113 일원", person: "홍길동", phone: "010-9999-0000", body: "도로 파손 보수 요청\n배수 확인", action: "현장 확인", due, status } });
    if (memo) call("set_complaint_memo", { id: c.id, memo });
  };
  complaint("2026-10-11", "접수", "2026-10-17", "포트홀", "전화");
  complaint("2026-10-12", "처리중", "2026-10-20", "배수불량", "국민신문고", '[{"t":"메모 내용"}]');
  complaint("2026-10-13", "완료", "2026-10-10", "차선도색", "방문");
  complaint("2026-10-14", "보류", "", "기타", "진정민원");
  complaint("2026-10-15", "접수", "2026-10-14", "소음", "정보공개청구");

  const admin = call("tasks_data").lists.find((l) => l.name === "행정업무").id;
  const task = (title, due, parent = null) => call("add_task", { task: { list: admin, parent, title, detail: "", due } });
  const t1 = task("예산 요구서 작성", "2026-10-16");
  task("증감 내역 정리", "2026-10-18", t1.id);
  task("행정사무감사 자료", "2026-10-25");
  call("set_task_done", { id: task("공문 회신", "2026-10-12").id, done: true, today: "2026-10-12" });

  const ev = (title, kind, date, end, allDay, time, endTime, repeat, until, place, remind) =>
    call("add_event", { event: { title, kind, date, end, allDay, time, endTime, repeat, until, place, desc: "", remind, remindTime: "" } });
  ev("방호벽 협의", "회의 · 협의", "2026-10-16", "2026-10-16", false, "10:00", "11:00", "", "", "72사단", -1);
  ev("현장 출장", "출장", "2026-10-20", "2026-10-21", true, "", "", "", "", "", -1);
  ev("주간회의", "업무 일정", "2026-10-05", "2026-10-05", false, "09:00", "10:00", "weekly", "2026-12-31", "", 10);
};
