; 기록 설치 파일 끝 단계(2026-10-20 탐색기 빠른 찾기, 사용자 2안):
; 빠른 찾기 도우미(gilog-search.exe)를 관리자 허용을 받아 서비스로 깔아요.
; 같은 판이 이미 깔려 돌고 있으면 묻지 않아요. "아니요"를 누르거나 관리자 권한이 없으면
; 깔지 않고 넘어가요(앱은 예전 찾기로 돌고, 설정 → 탐색기 [설치]로 다시 깔 수 있어요).
; 앱을 지우면 도우미가 10분 안에 스스로 빠져요(지울 때 관리자 허용을 묻지 않게).
!include LogicLib.nsh

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\gilog-search.exe"
    StrCpy $0 1
    ClearErrors
    ExecWait '"$INSTDIR\gilog-search.exe" check' $0
    ${If} $0 != 0
      ExecShellWait "runas" "$INSTDIR\gilog-search.exe" "install" SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
