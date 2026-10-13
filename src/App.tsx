import { useState } from "react";

// 화면 목록. 순서는 사양서의 사이드바 순서와 같아요.
const SCREENS = [
  { id: "journal", name: "업무일지", step: 5 },
  { id: "complaints", name: "민원대장", step: 6 },
  { id: "contacts", name: "업무연락처", step: 4 },
  { id: "calendar", name: "캘린더", step: 8 },
  { id: "todo", name: "할 일 목록", step: 7 },
] as const;

const SETTINGS = { id: "settings", name: "설정", step: 3 } as const;

type ScreenId = (typeof SCREENS)[number]["id"] | typeof SETTINGS.id;

const VERSION = "0.1.0";

export default function App() {
  const [current, setCurrent] = useState<ScreenId>("journal");
  const screen = [...SCREENS, SETTINGS].find((s) => s.id === current)!;

  return (
    <div className="shell">
      <nav className="side" aria-label="모듈">
        <div className="brand">giLog</div>
        <div className="side-list">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="side-item"
              aria-current={current === s.id ? "page" : undefined}
              onClick={() => setCurrent(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="side-item side-bottom"
          aria-current={current === SETTINGS.id ? "page" : undefined}
          onClick={() => setCurrent(SETTINGS.id)}
        >
          {SETTINGS.name}
        </button>
      </nav>
      <main className="main">
        <h1 className="title">{screen.name}</h1>
        <section className="card">
          <div className="card-head">설치 시험판 {VERSION}</div>
          <div className="card-body">
            <p>이 화면은 {screen.step}단계에서 만들어요.</p>
            <p className="muted">
              지금은 앱이 사무실 PC에 설치되고 켜지는지만 확인하는 판이에요. 왼쪽 메뉴를 눌러 화면이
              바뀌는지 봐 주세요.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
