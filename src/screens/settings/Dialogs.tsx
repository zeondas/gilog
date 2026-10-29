// 설정 – 적는 칸: 잠금 비밀번호 바꾸기(PasswordChange).
import { FormEvent, useState } from "react";
import { api, errorText } from "../../api";
import { Row, PIN_CHANGED } from "./parts";

export function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (newPw !== again) {
      setMsg("새 비밀번호 두 개가 서로 달라요.");
      return;
    }
    try {
      await api.changePassword(oldPw, newPw);
    } catch (err) {
      setMsg(err === "wrong_password" ? "지금 비밀번호가 맞지 않아요." : errorText(err));
      return;
    }
    // 윈도우 PIN 풀기가 켜져 있으면 Hello를 한 번 더 받고 새 비밀번호로 바꿔 보관해요(꺼져 있으면 그냥 지나가요).
    let done = "비밀번호를 바꿨어요.";
    try {
      const st = await api.pinStatus();
      if (st.on) {
        await api.pinRekey(newPw);
        done = "비밀번호를 바꿨어요. PIN 풀기용도 새것으로 바꿨어요.";
      }
    } catch {
      done = "비밀번호를 바꿨어요. PIN 풀기는 껐어요 – 다시 켜면 새 비밀번호로 보관해요.";
    }
    window.dispatchEvent(new Event(PIN_CHANGED));
    setOldPw("");
    setNewPw("");
    setAgain("");
    setOk(true);
    setMsg(done);
    setOpen(false);
  }

  return (
    <>
      <Row k="암호" label="잠금 비밀번호" desc={ok ? msg : "앱을 열 때 묻는 비밀번호예요. 잊으면 되찾을 수 없어요."}>
        <button type="button" className="btn" onClick={() => setOpen(!open)}>
          비밀번호 바꾸기
        </button>
      </Row>
      {open && (
        <form className="pw-form row" onSubmit={submit}>
          <label className="field">
            <span>지금 비밀번호</span>
            <input id="pw-old" className="input" type="password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 비밀번호</span>
            <input id="pw-new" className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 비밀번호 확인</span>
            <input id="pw-again" className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          <div className="pw-foot">
            <span className="gate-error" role="status">
              {ok ? "" : msg}
            </span>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              취소
            </button>
            <button type="submit" className="btn-primary btn-sm">
              바꾸기
            </button>
          </div>
        </form>
      )}
    </>
  );
}
