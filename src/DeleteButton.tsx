// "삭제" 단추 공통 부품(2026-10-25 사용자 – 창 위 닫기 ×와 헷갈리지 않게 글자로 "삭제").
// 누르면 바로 지우지 않아요: 감싼 쪽이 붉은 띠(AskBand)로 한 번 더 물어요(사용자 규칙 "지울까요?").
import { TrashIcon } from "./Icons";

export function DeleteButton({ label = "삭제", title, onClick, disabled }: { label?: string; title?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-xs btn-delete" title={title} disabled={disabled} onClick={onClick}>
      <TrashIcon />
      <span>{label}</span>
    </button>
  );
}
