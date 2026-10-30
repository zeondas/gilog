// 3년치 시험 자료(2023-10-18~2026-10-17, 브라우저 미리 보기 전용).
// docs/loadtest.md 5줄과 같은 비율(평일 하루 업무일지 8 · 민원 2 · 할 일 3 · 일정 2) — 개수는 사용자 지시(2026-10-21):
// 민원 1,500건 · 연락처 800명 · 할 일 6,000건. 업무일지·일정도 같은 비율로 넣어요(메모리·첫 화면이 실제와 비슷하게).
// 2026-10-30 ②-3 3차: 흉내 저장소에 값을 직접 넣던 것을 지킴이 seed처럼 앱과 같은 명령으로 채워요(tools/preview/core.ts가
// 화면이 처음 부르기 전에 한 번 불러요 – 연번·정리·검사는 실제 core 규칙). 민원·연락처는 엑셀 가져오기와 같은 명령(한 번에)이에요.
window.__previewSeed = async (call) => {
  const N = { complaints: 1500, contacts: 800, tasks: 6000, projects: 30 };
  let s = 20261021;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pad = (n) => String(n).padStart(2, "0");
  const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days = [];
  for (let d = new Date(2023, 9, 18); d <= new Date(2026, 9, 17); d.setDate(d.getDate() + 1)) if (d.getDay() % 6) days.push(ds(d));
  const addDays = (s0, n) => { const d = new Date(s0 + "T00:00:00"); d.setDate(d.getDate() + n); return ds(d); };
  const at = (i, n) => days[Math.min(days.length - 1, Math.floor((i * days.length) / n))];

  const AREAS = { "조리읍": ["봉일천리", "등원리", "뇌조리", "오산리"], "문산읍": ["문산리", "선유리", "당동리"], "법원읍": ["법원리", "대능리", "갈곡리"], "파주읍": ["파주리", "연풍리", "봉암리"], "광탄면": ["신산리", "용미리", "마장리"], "탄현면": ["법흥리", "성동리", "금승리"], "월롱면": ["위전리", "영태리"], "적성면": ["마지리", "구읍리"] };
  const AREA_KEYS = Object.keys(AREAS);
  const SUR = "김이박최정강조윤장임한오서신권황안송류홍";
  const GIV = ["민수", "영희", "정호", "지훈", "수진", "현우", "은지", "성민", "미경", "상훈", "다은", "준영", "혜진", "동욱", "선영"];
  const name = () => SUR[int(0, SUR.length - 1)] + pick(GIV);
  const phone = () => `010-${int(1000, 9999)}-${int(1000, 9999)}`;
  const WHAT = ["포트홀 보수 요청", "배수구 막힘 확인", "차선 도색 흐림", "보도블록 들뜸", "가로수 가지 정리", "도로 침하 확인", "맨홀 뚜껑 소음", "방호벽 파손", "제설 요청", "가드레일 휨", "도로 표지 훼손", "측구 정비"];
  const MORE = ["현장 사진 첨부", "야간 통행 위험", "주민 여러 명 같은 민원", "지난달에도 같은 곳 신고", "비 오면 물 고임", "학교 앞 통학로", "버스 정류장 앞", "농로 이어지는 곳"];
  const ACT = ["현장 확인 완료", "보수 업체 작업 지시", "아스콘 덧씌우기 예정", "배수구 준설 실시", "관계 부서 이첩", "민원인 유선 안내", "다음 주 작업 예정", "작업 완료 사진 촬영"];
  const lines = (pool, a, b) => JSON.stringify(Array.from({ length: int(a, b) }, () => ({ t: pick(pool) + (rnd() < 0.3 ? " – " + pick(MORE) : "") })));
  const INTAKE = ["전화", "방문", "국민신문고", "국민신문고", "국민신문고", "정보공개청구", "진정민원"];
  const CTYPE = ["포트홀", "배수불량", "차선도색", "보도", "가로수", "침하", "시설물", "제설", "기타"];

  call("create_store", { password: "1234" });
  call("set_prefs", { prefs: { ...call("get_prefs"), askPassword: false, theme: window.__loadTheme || "light", startScreen: window.__loadStart || "journal" } });

  // 프로젝트 30개(셋에 하나는 줄인 이름) · 연락처 800명(엑셀 가져오기와 같은 명령, 프로젝트는 이름으로)
  const projNames = Array.from({ length: N.projects }, (_, i) => `시도${i + 3}호선 도로정비`);
  for (const p of projNames) call("add_project", { name: p });
  const pid = Object.fromEntries(call("contacts_data").projects.map((p) => [p.name, p.id]));
  projNames.forEach((p, i) => { if (i % 3 === 0) call("set_project_names", { id: pid[p], name: p, alias: `시도${i + 3}` }); });
  const ORGS = ["72사단", "○○설계", "도로관리과", "건설과", "△△건설", "□□엔지니어링", "읍사무소", "경기도청", "한국전력", "KT"];
  const ROLES = ["과장", "주무관", "팀장", "대리", "소장", "시설장교", "현장대리인"];
  const people = Array.from({ length: N.contacts }, (_, i) => ({
    name: name(), org: pick(ORGS), role: pick(ROLES), mobile: phone(), tel: rnd() < 0.5 ? `031-${int(900, 999)}-${int(1000, 9999)}` : "",
    email: rnd() < 0.3 ? `user${i}@ex.kr` : "", memo: rnd() < 0.25 ? lines(MORE, 1, 3) : "",
    projects: Array.from(new Set(Array.from({ length: int(0, 3) }, () => projNames[int(0, N.projects - 1)]))),
  }));
  call("import_contacts", { rows: people, replace: false });
  const contacts = call("contacts_data").contacts;

  // 민원 1,500건(오래된 것은 대부분 완료) – 엑셀 가져오기와 같은 명령, 연번은 core가 접수일 순으로 매겨요
  const rows = Array.from({ length: N.complaints }, (_, i) => {
    const received = at(i, N.complaints);
    const old = i < N.complaints - 60;
    const status = old ? (rnd() < 0.9 ? "완료" : pick(["불가", "보류", "장기"])) : pick(["접수", "진행", "답변", "진행"]);
    const area = pick(AREA_KEYS);
    const intake = pick(INTAKE);
    return {
      intake, received, ctype: pick(CTYPE), area, place: `${pick(AREAS[area])} ${int(1, 999)}${rnd() < 0.5 ? "-" + int(1, 30) : ""} 일원`,
      person: name(), phone: phone(), body: lines(WHAT, 3, 5), action: lines(ACT, old ? 3 : 1, old ? 5 : 3),
      due: intake === "국민신문고" || rnd() < 0.5 ? addDays(received, 14) : "", status,
      done: status === "완료" || status === "불가" ? addDays(received, int(2, 20)) : "", road: "", memo: rnd() < 0.3 ? lines(MORE, 2, 2) : "",
    };
  });
  call("import_complaints", { rows, replace: false });

  // 할 일 6,000건(목록 4개 – "민원"·"행정업무"는 처음부터 있어요, 위 항목마다 하위 0~2개, 오래된 것은 완료)
  for (const n of ["공사 감독", "예산"]) call("add_task_list", { name: n });
  const listId = Object.fromEntries(call("tasks_data").lists.map((l) => [l.name, l.id]));
  const LISTS = [listId["행정업무"], listId["공사 감독"], listId["예산"]];
  const TT = ["공문 회신", "예산 요구서 작성", "현장 점검", "준공 검사", "설계 검토", "실정보고", "행정사무감사 자료", "기성 검사", "회의 자료 준비", "업체 연락"];
  let made = 0;
  while (made < N.tasks) {
    const day = at(made, N.tasks);
    const old = day < "2026-09-20";
    const list = pick(LISTS);
    const due = rnd() < 0.8 ? addDays(day, int(1, 20)) : "";
    const top = call("add_task", { task: { list, parent: null, title: pick(TT) + " " + (made + 1), detail: rnd() < 0.4 ? lines(MORE, 1, 2) : "", due } });
    made++;
    for (let k = int(0, 2); k > 0 && made < N.tasks; k--) {
      call("add_task", { task: { list, parent: top.id, title: pick(TT) + " 하위 " + (made + 1), detail: "", due } });
      made++;
    }
    if (old) call("set_task_done", { id: top.id, done: true, today: addDays(day, int(0, 10)) });
  }

  // 업무일지(평일 8건 – 말 7 + 메모 카드 1·표 하나) · 일정(평일 2건 + 반복 10개)
  const KINDS = ["유선수신", "유선발신", "회의", "협의", "현장"];
  for (const date of days) {
    call("set_journal_day", { day: { date, arrive: "08:40", transport: "", weather: "", note: "" } });
    for (let k = 0; k < 7; k++) {
      const c = contacts[int(0, contacts.length - 1)];
      call("add_journal_entry", { entry: { date, time: `${pad(9 + k)}:${pad(int(0, 59))}`, kind: pick(KINDS), who: c.name, contact: c.mobile, project: c.projects[0] ?? null, lines: [{ who: c.name, me: false, text: pick(WHAT) }, { who: "나", me: true, text: pick(ACT) }], body: "" } });
    }
    call("add_journal_entry", { entry: { date, time: "17:30", kind: "메모", who: "", contact: "", project: null, lines: [], body: "<p>" + pick(ACT) + "</p><table><tr><td>구간</td><td>물량</td></tr><tr><td>1</td><td>2</td></tr></table>" } });
  }
  const EK = ["업무 일정", "회의 · 협의", "출장"];
  const ev = (title, kind, date, allDay, time, endTime, repeat, until) =>
    call("add_event", { event: { title, kind, date, end: date, allDay, time: allDay ? "" : time, endTime: allDay ? "" : endTime, repeat, until, place: "", desc: "", remind: -1, remindTime: "" } });
  for (const date of days) for (let k = 0; k < 2; k++) ev(pick(TT), pick(EK), date, rnd() < 0.3, "10:00", "11:00", "", "");
  for (let k = 0; k < 10; k++) ev("주간회의 " + k, "회의 · 협의", "2024-01-0" + ((k % 5) + 1), false, "09:00", "10:00", "weekly", "2027-12-31");
};
