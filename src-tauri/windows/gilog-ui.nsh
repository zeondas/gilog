; 기록 설치·제거 창 – 크롬식 원클릭 · 보라 띠 (2026-10-25 사용자 2안 + 글자 배치 3안, 공통 ✔6·✔2)
; 시안: 캔버스 판 Installer.dc.html 3안 · 그림 원본 installer/src/assets.html(make.py로 PNG를 만들고 build.yml이 BMP로 바꿔요)
;
; installer.nsi(Tauri 2.10.2 틀을 복사해 고친 것)가 이 파일을 쪽(page) 정의 바로 앞에서 불러요.
; - 설치: 쪽은 instfiles 하나. 창 바깥 머리·단추·줄은 숨기고, 창 안쪽 520×400에 그림(띠·글자)을 깔고 진행 막대만 앱이 그려요.
;   다 되면 그림을 "설치를 마쳤어요 / 곧 기록이 열려요"로 바꾸고 2초 뒤 기록을 열고 닫혀요.
; - 제거: 확인 쪽(nsDialogs) – 그림 + 체크 상자 + 그림 단추. "기록 자료도 지우기"를 켜면 붉은 띠와 [자료까지 제거].
;   제거 중 쪽도 같은 그림 방식, 끝나면 저절로 닫혀요.
; 자리 값(px)은 100% 기준이고 화면 DPI만큼 키워요. 그림은 100·125·150·175·200% 중 가까운 것을 골라요.
; 창 제목 줄은 윈도우 기본 그대로예요(창 끌기·닫기).

!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!define GILOG_W 520
!define GILOG_H 400
!define /ifndef STM_SETIMAGE 0x0172
!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR 0x2001

Var GilogDpi
Var GilogScale
Var GilogBg
Var GilogBar
Var GilogFill
Var GilogTrack
Var GilogDoneBmp
Var GilogBand
Var GilogBtnCancel
Var GilogBtnRemove
Var GilogBtnRemoveData

; 100% 기준 px → 지금 DPI px
!macro GILOG_PX out n
  IntOp ${out} ${n} * $GilogDpi
  IntOp ${out} ${out} / 96
!macroend
!define GilogPx "!insertmacro GILOG_PX"

; 창 DPI와 고를 그림 배율
!macro GILOG_SCALE_BODY
  StrCpy $0 0
  System::Call "user32::GetDpiForWindow(p $HWNDPARENT) i .r0"
  ${If} $0 == "error"
  ${OrIf} $0 < 96
    StrCpy $0 96
  ${EndIf}
  StrCpy $GilogDpi $0
  IntOp $1 $0 * 100
  IntOp $1 $1 / 96
  ${If} $1 < 113
    StrCpy $GilogScale 100
  ${ElseIf} $1 < 138
    StrCpy $GilogScale 125
  ${ElseIf} $1 < 163
    StrCpy $GilogScale 150
  ${ElseIf} $1 < 188
    StrCpy $GilogScale 175
  ${Else}
    StrCpy $GilogScale 200
  ${EndIf}
!macroend

; 창 안쪽을 520×400(DPI만큼)으로 – 가운데 자리는 그대로
!macro GILOG_RESIZE_BODY
  System::Call "*(i, i, i, i) p .r6"
  System::Call "user32::GetWindowRect(p $HWNDPARENT, p r6)"
  System::Call "*$6(i .r1, i .r2, i .r3, i .r4)"
  System::Call "user32::GetClientRect(p $HWNDPARENT, p r6)"
  System::Call "*$6(i, i, i .r7, i .r8)"
  System::Free $6
  ; 테두리·제목 줄 두께
  IntOp $5 $3 - $1
  IntOp $5 $5 - $7
  IntOp $9 $4 - $2
  IntOp $9 $9 - $8
  ; 새 크기
  ${GilogPx} $7 ${GILOG_W}
  ${GilogPx} $8 ${GILOG_H}
  IntOp $7 $7 + $5
  IntOp $8 $8 + $9
  ; 가운데 맞춤: 새 왼쪽 = 옛 가운데 - 새 폭/2
  IntOp $5 $1 + $3
  IntOp $5 $5 / 2
  IntOp $0 $7 / 2
  IntOp $5 $5 - $0
  IntOp $9 $2 + $4
  IntOp $9 $9 / 2
  IntOp $0 $8 / 2
  IntOp $9 $9 - $0
  System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i r5, i r9, i r7, i r8, i 0x14)"
!macroend

; 창 바깥(머리 글·줄·단추·브랜드 글) 숨기고 안쪽 쪽(#32770)을 창 전체로
!macro GILOG_FRAME_BODY
  System::Call "user32::GetWindow(p $HWNDPARENT, i 5) p .r0"
  ${DoWhile} $0 P<> 0
    System::Call "user32::GetClassName(p r0, w .r1, i ${NSIS_MAX_STRLEN})"
    ${If} $1 != "#32770"
      ShowWindow $0 ${SW_HIDE}
    ${Else}
      ${GilogPx} $2 ${GILOG_W}
      ${GilogPx} $3 ${GILOG_H}
      System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i r2, i r3, i 0x14)"
    ${EndIf}
    System::Call "user32::GetWindow(p r0, i 2) p .r0"
  ${Loop}
!macroend

; 그림 하나 읽기: $PLUGINSDIR\<이름>_<배율>.bmp, 크기 w×h(100% px) → $0 (HBITMAP)
!macro GILOG_LOAD name w h
  ${GilogPx} $1 ${w}
  ${GilogPx} $2 ${h}
  System::Call "user32::LoadImage(p 0, w '$PLUGINSDIR\${name}_$GilogScale.bmp', i 0, i r1, i r2, i 0x10) p .r0"
!macroend

; 그림 자리(STATIC SS_BITMAP) 만들기: 부모 $R9, 자리 x y(100% px), 그림 이름·크기 → $0 (창 손잡이)
!macro GILOG_PICTURE x y name w h
  !insertmacro GILOG_LOAD ${name} ${w} ${h}
  StrCpy $R8 $0
  ${GilogPx} $3 ${x}
  ${GilogPx} $4 ${y}
  System::Call "user32::CreateWindowEx(i 0, w 'STATIC', w '', i 0x5400010E, i r3, i r4, i r1, i r2, p $R9, p 0, p 0, p 0) p .r0"
  SendMessage $0 ${STM_SETIMAGE} 0 $R8
!macroend
; 0x5400010E = WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS|SS_NOTIFY|SS_BITMAP

; nsDialogs 쪽의 그림 자리(누르기 받으려면 nsDialogs가 만들어야 해요) → $0
!macro GILOG_NSD_PICTURE x y name w h
  !insertmacro GILOG_LOAD ${name} ${w} ${h}
  StrCpy $R8 $0
  ${GilogPx} $3 ${x}
  ${GilogPx} $4 ${y}
  ${NSD_CreateBitmap} $3 $4 $1 $2 ""
  Pop $0
  SendMessage $0 ${STM_SETIMAGE} 0 $R8
!macroend

; 진행 막대: 윈도우 막대(색을 못 바꾸는 곳이 있어요)는 숨기고, 옅은 보라 길(#EEEAFF)과 보라 채움(#4B37C4)을 앱이 그려요.
; 채움은 설치·제거 단계마다 GILOG_STEP으로 늘려요(설치는 1~2초라 단계로 충분해요). 자리 x y w(100% px), 높이 4.
!macro GILOG_BAR x y w
  ShowWindow $GilogBar ${SW_HIDE}
  ${GilogPx} $1 ${x}
  ${GilogPx} $2 ${y}
  ${GilogPx} $3 ${w}
  ${GilogPx} $4 4
  System::Call "user32::CreateWindowEx(i 0, w 'STATIC', w '', i 0x54000000, i r1, i r2, i r3, i r4, p $R9, p 0, p 0, p 0) p .r0"
  SetCtlColors $0 0xEEEAFF 0xEEEAFF
  System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 0x43)"
  StrCpy $GilogTrack $0
  System::Call "user32::CreateWindowEx(i 0, w 'STATIC', w '', i 0x54000000, i r1, i r2, i 0, i r4, p $R9, p 0, p 0, p 0) p .r0"
  SetCtlColors $0 0x4B37C4 0x4B37C4
  System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 0x43)"
  StrCpy $GilogFill $0
!macroend
; 0x43 = SWP_SHOWWINDOW|SWP_NOMOVE|SWP_NOSIZE – 맨 위(HWND_TOP)로(바탕 그림이 덮지 않게)

; 채움을 pct%로(조용한 설치·막대가 없을 때는 아무것도 안 해요)
!macro GILOG_STEP pct
  ${If} $GilogFill P<> 0
    IntOp $R7 360 * ${pct}
    IntOp $R7 $R7 / 100
    ${GilogPx} $R7 $R7
    ${GilogPx} $R6 4
    System::Call "user32::SetWindowPos(p $GilogFill, p 0, i 0, i 0, i R7, i R6, i 0x16)"
    System::Call "user32::InvalidateRect(p $GilogFill, p 0, i 1)"
  ${EndIf}
!macroend
; 0x16 = SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE

; instfiles 쪽 꾸미기: 바탕 그림 이름, 막대 자리 y
!macro GILOG_INSTFILES_BODY bg bary
  !insertmacro GILOG_FRAME_BODY
  FindWindow $R9 "#32770" "" $HWNDPARENT
  GetDlgItem $0 $R9 1006
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R9 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R9 1027
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $GilogBar $R9 1004
  !insertmacro GILOG_PICTURE 0 0 ${bg} ${GILOG_W} ${GILOG_H}
  StrCpy $GilogBg $0
  ; 바탕은 맨 아래, 막대는 그 위
  System::Call "user32::SetWindowPos(p $GilogBg, p 1, i 0, i 0, i 0, i 0, i 0x13)"
  !insertmacro GILOG_BAR 80 ${bary} 360
!macroend

; ---------------- 설치 ----------------

Function GilogGuiInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${GILOG_ASSETS}\inst_bg_*.bmp"
  File "${GILOG_ASSETS}\inst_done_*.bmp"
  !insertmacro GILOG_SCALE_BODY
  !insertmacro GILOG_RESIZE_BODY
FunctionEnd

Function GilogInstShow
  !insertmacro GILOG_INSTFILES_BODY inst_bg 333
  ; 끝 그림은 미리 읽어 둬요(설치가 끝나면 바꿔 끼워요)
  !insertmacro GILOG_LOAD inst_done ${GILOG_W} ${GILOG_H}
  StrCpy $GilogDoneBmp $0
  ; 띠 위 왼쪽 판 번호
  ${GilogPx} $1 20
  ${GilogPx} $2 16
  ${GilogPx} $3 160
  ${GilogPx} $4 18
  System::Call "user32::CreateWindowEx(i 0, w 'STATIC', w '${VERSION}', i 0x54000000, i r1, i r2, i r3, i r4, p $R9, p 0, p 0, p 0) p .r0"
  SetCtlColors $0 0x8C8A98 0xF1EEFF
  CreateFont $1 "Malgun Gothic" 9 600
  SendMessage $0 ${WM_SETFONT} $1 1
  System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 0x43)"
  System::Call "user32::InvalidateRect(p r0, p 0, i 1)"
FunctionEnd

; 설치가 끝나면(사람이 보는 설치일 때만): 끝 그림 → 2초 → 기록 열기 → 닫기
!macro GILOG_DONE_SECTION
Section -GilogDone
  ${If} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    !insertmacro GILOG_STEP 100
    Sleep 300
    SendMessage $GilogBg ${STM_SETIMAGE} 0 $GilogDoneBmp
    ; 막대(길·채움)는 끝 그림에서 감춰요
    ShowWindow $GilogFill ${SW_HIDE}
    ShowWindow $GilogTrack ${SW_HIDE}
    Sleep 2000
    Call RunMainBinary
    SetAutoClose true
  ${EndIf}
SectionEnd
!macroend

; ---------------- 제거 ----------------

Function un.GilogGuiInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${GILOG_ASSETS}\un_bg_*.bmp"
  File "${GILOG_ASSETS}\un_prog_*.bmp"
  File "${GILOG_ASSETS}\un_band_*.bmp"
  File "${GILOG_ASSETS}\btn_*.bmp"
  !insertmacro GILOG_SCALE_BODY
  !insertmacro GILOG_RESIZE_BODY
FunctionEnd

Function un.GilogConfirm
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $R9
  ${If} $R9 == error
    Abort
  ${EndIf}
  !insertmacro GILOG_FRAME_BODY
  ; 바탕(띠·제목·체크 글)
  !insertmacro GILOG_NSD_PICTURE 0 0 un_bg ${GILOG_W} ${GILOG_H}
  StrCpy $GilogBg $0
  ; 체크 상자(글 없이 – 글은 그림), 글을 눌러도 켜지고 꺼져요
  ${GilogPx} $1 162
  ${GilogPx} $2 254
  ${GilogPx} $3 16
  ${NSD_CreateCheckbox} $1 $2 $3 $3 ""
  Pop $DeleteAppDataCheckbox
  ${NSD_OnClick} $DeleteAppDataCheckbox un.GilogToggled
  ${GilogPx} $1 188
  ${GilogPx} $2 252
  ${GilogPx} $3 190
  ${GilogPx} $4 38
  ${NSD_CreateLabel} $1 $2 $3 $4 ""
  Pop $0
  SetCtlColors $0 0x1C1B22 transparent
  ${NSD_OnClick} $0 un.GilogLabelClick
  ; 붉은 띠·단추
  !insertmacro GILOG_NSD_PICTURE 60 300 un_band 400 36
  StrCpy $GilogBand $0
  ShowWindow $GilogBand ${SW_HIDE}
  !insertmacro GILOG_NSD_PICTURE 196 318 btn_cancel 61 34
  StrCpy $GilogBtnCancel $0
  ${NSD_OnClick} $GilogBtnCancel un.GilogCancel
  !insertmacro GILOG_NSD_PICTURE 265 318 btn_remove 61 34
  StrCpy $GilogBtnRemove $0
  ${NSD_OnClick} $GilogBtnRemove un.GilogGo
  !insertmacro GILOG_NSD_PICTURE 238 352 btn_remove_data 113 34
  StrCpy $GilogBtnRemoveData $0
  ShowWindow $GilogBtnRemoveData ${SW_HIDE}
  ${NSD_OnClick} $GilogBtnRemoveData un.GilogGo
  ; 그림을 바꿔 끼우면 그 자리가 맨 위로 올라가는 일이 있어요 – 바탕은 맨 아래로
  System::Call "user32::SetWindowPos(p $GilogBg, p 1, i 0, i 0, i 0, i 0, i 0x13)"
  ${NSD_SetFocus} $DeleteAppDataCheckbox
  nsDialogs::Show
FunctionEnd

Function un.GilogLabelClick
  Pop $0
  ${NSD_GetState} $DeleteAppDataCheckbox $1
  ${If} $1 == ${BST_CHECKED}
    ${NSD_Uncheck} $DeleteAppDataCheckbox
  ${Else}
    ${NSD_Check} $DeleteAppDataCheckbox
  ${EndIf}
  Push $DeleteAppDataCheckbox
  Call un.GilogToggled
FunctionEnd

; 체크를 켜면: 붉은 띠 + [취소][자료까지 제거](아래로), 끄면 [취소][제거]
Function un.GilogToggled
  Pop $0
  ${NSD_GetState} $DeleteAppDataCheckbox $1
  ${If} $1 == ${BST_CHECKED}
    ShowWindow $GilogBand ${SW_SHOW}
    ShowWindow $GilogBtnRemove ${SW_HIDE}
    ShowWindow $GilogBtnRemoveData ${SW_SHOW}
    ${GilogPx} $2 169
    ${GilogPx} $3 352
  ${Else}
    ShowWindow $GilogBand ${SW_HIDE}
    ShowWindow $GilogBtnRemoveData ${SW_HIDE}
    ShowWindow $GilogBtnRemove ${SW_SHOW}
    ${GilogPx} $2 196
    ${GilogPx} $3 318
  ${EndIf}
  System::Call "user32::SetWindowPos(p $GilogBtnCancel, p 0, i r2, i r3, i 0, i 0, i 0x15)"
FunctionEnd

Function un.GilogCancel
  Pop $0
  SendMessage $HWNDPARENT ${WM_COMMAND} 2 0
FunctionEnd

Function un.GilogGo
  Pop $0
  SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
FunctionEnd

Function un.GilogConfirmLeave
  ${NSD_GetState} $DeleteAppDataCheckbox $DeleteAppDataCheckboxState
FunctionEnd

Function un.GilogUnShow
  !insertmacro GILOG_INSTFILES_BODY un_prog 298
FunctionEnd

; 자료도 지우기(체크 켬, 업데이트 아님): 문서\giLog(gilog.db·백업)와 윈도우 자격 증명 "giLog"(keyring 3 – 대상 이름 data-key.giLog)
; 민원 폴더(설정에서 고른 D:\민원처리 등)는 지우지 않아요.
!macro GILOG_DELETE_USER_DATA
  SetShellVarContext current
  RmDir /r "$DOCUMENTS\giLog"
  System::Call "advapi32::CredDeleteW(w 'data-key.giLog', i 1, i 0) i .r0"
!macroend
