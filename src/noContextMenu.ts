// 브라우저 기본 우클릭 메뉴(뒤로·새로 고침·다른 이름으로 저장·인쇄)를 앱 전체에서 꺼요
// (공통 결정 로그 2026-10-21 19:01 – 민원대장에서 "다른 이름으로 저장"이 한글 프로그램을 여는 등 엉뚱하게 동작했어요).
// 입력 칸 안과 글을 골라 둔 곳에서만 기본 메뉴(잘라내기·복사·붙여넣기)를 남겨요.
// 화면이 자기 메뉴를 띄우며 preventDefault 한 것은 그대로 둬요(문서 단계라 화면 처리 뒤에 와요).
export function installNoContextMenu(): void {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
    if (t && onSelection(t)) return;
    e.preventDefault();
  });
}

/** 고른 글 위를 우클릭했는지(어딘가에 남은 고른 글은 치지 않아요) */
export function onSelection(t: Node): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && !!sel.toString() && sel.containsNode(t, true);
}
