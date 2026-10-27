// 설정 – 조각끼리 함께 쓰는 줄 틀(Row)·스위치(Toggle)·× 그림(X)·PIN 알림 이름(PIN_CHANGED).

// ---------- 부품 ----------

export function Row({
  label,
  desc,
  children,
  last,
  k,
}: {
  label: string;
  desc: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
  /** 찾기에만 쓰는 숨은 낱말 */
  k?: string;
}) {
  return (
    <div className={"row" + (last ? " row-last" : "")} data-k={k}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        <span className="muted small">{desc}</span>
      </span>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  desc,
  on,
  onChange,
  k,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
  k?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row row-btn" onClick={() => onChange(!on)} data-k={k}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        <span className="muted small">{desc}</span>
      </span>
      <span className={"switch" + (on ? " on" : "")} aria-hidden="true">
        <span className="knob" />
      </span>
    </button>
  );
}

/** 비밀번호를 바꾼 뒤 PIN 줄이 다시 읽게 알려요. */
export const PIN_CHANGED = "gilog-pin-changed";

export function X() {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
