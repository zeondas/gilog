# 캘린더: 흉내 자료는 구글 연결이 안 돼 상태 상자가 없어요 – 앱과 같은 모양(.g-box)을 왼쪽 열 끝에 그려 넣어요.
async def s_calendar_google(p):
    await p.evaluate("""() => {
      const side = document.querySelector('aside.cal-side') || document.querySelector('.cal-upcoming').parentElement;
      if (side.querySelector('.g-box')) return;
      const d = document.createElement('div');
      d.className = 'g-box';
      d.innerHTML = '<div class="g-box-head"><span class="g-dot" aria-hidden="true"></span><span>구글 캘린더 연동됨</span></div>'
        + '<span class="g-box-sub">기록 → 구글 한 방향<span class="g-box-at">마지막 성공 오늘 09:12</span></span>'
        + '<button type="button" class="btn btn-xs">지금 내보내기</button>';
      side.appendChild(d);
    }""")
    await p.wait_for_timeout(200)

EXTRA = {"calendar_google": ("캘린더", s_calendar_google)}
