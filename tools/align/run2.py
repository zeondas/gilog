import asyncio,sys
from measure import run
def nav(n):
    async def f(pg):
        await pg.goto("http://localhost:5175/"); await pg.wait_for_timeout(500); await pg.evaluate("document.fonts.ready.then(()=>1)")
        await pg.locator(".side-item",has_text=n).first.click(); await pg.wait_for_timeout(300)
    return f
def seq(*fs):
    async def f(pg):
        for x in fs: await x(pg); await pg.wait_for_timeout(250)
    return f
def click(sel, n=0, dbl=False):
    async def f(pg):
        l=pg.locator(sel).nth(n)
        await (l.dblclick() if dbl else l.click())
    return f
def typ(sel, text, *keys):
    async def f(pg):
        await pg.locator(sel).first.click(); await pg.keyboard.type(text)
        for k in keys: await pg.keyboard.press(k)
    return f
def scroll(y):
    async def f(pg):
        await pg.evaluate("y=>{const s=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(e).overflowY));s.forEach(e=>e.scrollTop=y)}",y)
    return f
J,C,P,K,T,S=[nav(x) for x in ["업무일지","민원대장","업무연락처","캘린더","할 일 목록","설정"]]
acts=[
 ("업무일지",J),
 ("업무일지-고치기",seq(J,click(".jcard:not(.jcard-new):not(.jcard-memo)",0,True))),
 ("업무일지-지우기묻기",seq(J,click(".jcard:not(.jcard-new):not(.jcard-memo)",0,True),click('[aria-label="이 기록 지우기"]'))),
 ("업무일지-메모편집기*",seq(J,typ('[aria-label="새 기록 입력"] [aria-label="구분"]',"메모","Tab"))),
 ("민원대장",C),
 ("민원대장-분류관리",seq(C,click('button:has-text("분류 관리")'))),
 ("민원대장-상태목록",seq(C,click('.cm-status-btn'))),
 ("민원대장-고치기",seq(C,click('.cm-view',1,True))),
 ("민원대장-메모",seq(C,click('[aria-label="메모 편집"]'))),
 ("업무연락처",P),
 ("업무연락처-프로젝트관리",seq(P,click('button:has-text("프로젝트 관리")'))),
 ("업무연락처-고치기",seq(P,click('[aria-label$="고치기"]'))),
 ("캘린더",K),
 ("캘린더-관리",seq(K,click('.cal-manage'))),
 ("캘린더-알림확인",seq(K,click('.cal-manage'),click('[aria-label="알림 확인"]'))),
 ("캘린더-상세",seq(K,click('.cal-detail-btn'))),
 ("캘린더-주",seq(K,click('[aria-label="보기 방식"] button',1))),
 ("캘린더-일정고치기",seq(K,click('[aria-label="보기 방식"] button',0),click('.cal-ev:not(.linked)',0,True))),
 ("할 일 목록",T),
 ("할 일-추가*",seq(T,click('.td-add-title'))),
 ("설정",S),("설정2",seq(S,scroll(900))),("설정3",seq(S,scroll(1800))),("설정4",seq(S,scroll(2700))),
 ("잠금",seq(S,click('.side-item:has-text("잠그기")'))),
 ("민원대장-지우기묻기",seq(C,click('.cm-view',1,True),click('.cm-edit [aria-label*="지우기"], .cm-edit [aria-label*="삭제"]'))),
 ("업무연락처-지우기묻기",seq(P,click('[aria-label$="지우기"], [aria-label$="삭제"]'))),
]
css="".join(open(f).read() for f in sys.argv[2:] if f.endswith(".css"))
js="".join(open(f).read() for f in sys.argv[2:] if f.endswith(".js"))
r=asyncio.run(run(acts,sys.argv[1],css,js))
print(len(r))
