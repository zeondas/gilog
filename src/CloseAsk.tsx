// 설정 "닫기(X) 단추"가 "프로그램 종료"일 때 X를 누르면 뜨는 창이에요(2026-10-18 앱 창 세션).
// Rust(calendar.rs)가 "close-ask"를 보내면 열려요. 잠금 화면에서도 같아요(App 바깥에 붙어 있어요).
// Enter = 끝내기, Esc·바깥 누르기 = 취소. 브라우저 미리 보기는 주소 끝에 ?closeask
import { DialogX } from "./DialogX";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { api, inApp } from "./api";
import { overlayDown } from "./useOutsideClose";

export default function CloseAsk() {
  const [open, setOpen] = useState(() => !inApp && location.search.includes("closeask"));

  useEffect(() => {
    if (!inApp) return;
    const off = listen("close-ask", () => setOpen(true));
    return () => {
      off.then((f) => f());
    };
  }, []);

  const quit = () => {
    void api.quitApp().then(() => !inApp && setOpen(false));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") setOpen(false);
        else quit();
      }
    };
    // 다른 창·화면의 Enter·Esc보다 먼저 받아요.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="overlay close-ask-ov" onMouseDown={overlayDown(() => setOpen(false))}>
      <div className="dialog close-ask" role="alertdialog" aria-modal="true" aria-labelledby="close-ask-title">
        <DialogX label="취소" onClick={() => setOpen(false)} />
        <div className="xl-ask-body">
          <h2 id="close-ask-title" className="xl-ask-title">
            기록을 끝낼까요?
          </h2>
        </div>
        <div className="xl-ask-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={() => setOpen(false)}>
            취소
          </button>
          <button type="button" className="btn-primary btn-ctrl" autoFocus onClick={quit}>
            끝내기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
