# 머리 줄 시안 그림 (상단 정리 세션, 2026-10-19)
#   python3 topbar_mock.py <폴더> <안 이름> [1|1.25] [light|dark]
# 미리 보기(5175)의 실제 화면에서 머리 줄 요소를 그대로 옮겨 새 규칙으로 다시 놓고 찍어요.
# 앱 코드는 바꾸지 않아요(화면 안에서만 DOM을 옮김). 안: p1 | p2
import asyncio, io, json, os, sys
from PIL import Image
from playwright.async_api import async_playwright

OUT, PLAN = sys.argv[1], sys.argv[2]
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
THEME = sys.argv[4] if len(sys.argv) > 4 else "light"
URL = os.environ.get("ALIGN_URL", "http://localhost:5175/")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = open(os.path.join(HERE, "seed.js")).read().replace('theme: "light"', f'theme: "{THEME}"')
Y0, Y1 = 8, 76

PLANS = {
    # 1안: 간격 8 하나 · 검색 280 모든 화면 · 검색은 양쪽 묶음 사이 가운데 · 토글 34 상자 안 26(채운 강조색)
    "p1": {"gap": 8, "search": 280, "search_explorer": 280, "center": True, "seg": "box"},
    # 2안: 간격 12 하나 · 검색 320(탐색기만 240 — 단추 11개) · 검색은 오른쪽 단추 바로 앞 · 토글 28 상자 없음(칩 28·6)
    "p2": {"gap": 12, "search": 320, "search_explorer": 240, "center": False, "seg": "flat"},
    # 규칙안(2026-10-19 23:23 사용자 확정한 배치 규칙): 요소 사이 8 · 묶음 사이·제목 뒤 16 · 검색 260은 오른쪽 묶음 안 · 토글 34 안 26
    # 한 줄안(23:45 사용자: 두 줄 안 됨): 검색은 늘 오른쪽 끝(윈도우 탐색기·구글 캘린더처럼) — 같은 자리
    "one": {"gap": 8, "ggap": 16, "search": 260, "search_explorer": 260, "center": False, "seg": "box", "groups": True, "one": True},
    # 23:53 사용자 규칙: 엑셀 → 검색 → 입력창 띄우는 단추(관리·세부사업 추가), 정하지 않은 것은 뺌
    "six": {"gap": 8, "ggap": 8, "search": 260, "search_explorer": 260, "center": False, "seg": "box", "groups": True, "six": True},
    "rule": {"gap": 8, "ggap": 16, "search": 260, "search_explorer": 260, "center": False, "seg": "box", "groups": True},
}
P = PLANS[PLAN]

# 규칙안: 묶음 목록(묶음 안 8, 묶음 사이 16). "@search"가 검색 자리.
GROUPS = {
    "탐색기":   {"L": [["트리보기", "두칸보기", "네칸보기"], ["펼쳐보기", "미리보기", "숨긴파일"]],
                "R": [["배치복구", "@search"], ["새로고침", "같은폴더", "창바꾸기", "이름변경"]], "S": "파일 검색"},
    "민원대장": {"L": [["@chips"]], "R": [["배치최적화", "@search"], ["엑셀"], ["분류 관리"]], "S": "위치·내용·민원인 검색", "typed": "봉일천"},
    "민원처리": {"L": [["@title"]], "R": [["@search"], ["신문고 열기", "민원 불러오기"], ["공사 관리"]], "S": "접수번호·위치·내용 검색"},
    "캘린더":   {"L": [["@title"], ["이전 달", "오늘", "다음 달"], ["@seg"]], "R": [["@search"], ["@calmgr"]], "S": "일정 검색"},
    "할 일":    {"L": [["@title"]], "R": [["@search"]], "S": "할 일 검색", "hide": [".td-summary"]},
    "업무일지": {"L": [["@title"]], "R": [["@search"], ["엑셀", "인쇄"]], "S": "사람·내용 검색"},
    "업무연락처": {"L": [["@title"]], "R": [["@search"], ["엑셀"], ["프로젝트 관리"]], "S": "이름·소속·번호 검색"},
    "집행현황": {"L": [["@title"], ["@year"]], "R": [["@seg:집행액", "@seg:원", "배치최적화", "@search"], ["세부사업 추가", "엑셀"]], "S": "공사명·업체 검색"},
    "예산현황": {"L": [["@title"], ["@year"], ["@seg:요약"]], "R": [["@seg:원", "배치최적화", "@search"], ["엑셀"]], "S": "세부사업 검색"},
    "설정":     {"L": [["@title"]], "R": [["@search"], ["기본값으로 되돌리기", "설정 닫기"]], "S": "설정 검색"},
}


# 화면마다 자리: L 왼쪽(제목·무엇을 보는지) / A 표 조정·단위(검색 왼쪽) / S 검색 / R 동작(추가 → 엑셀 → 인쇄 → 관리)
# 요소 이름: 글자(단추 글자·aria-label 앞부분) 또는 특별 이름
SPEC = {
    "탐색기":   {"L": ["트리보기", "두칸보기", "네칸보기", "펼쳐보기", "미리보기", "숨긴파일"], "A": ["배치복구"], "S": "파일 검색",
                "R": ["새로고침", "같은폴더", "창바꾸기", "이름변경"]},
    "민원대장": {"L": ["@chips"], "A": ["배치최적화"], "S": "위치·내용·민원인 검색", "R": ["엑셀", "분류 관리"], "typed": "봉일천"},
    "민원처리": {"L": ["@title"], "A": [], "S": "접수번호·위치·내용 검색", "R": ["신문고 열기", "민원 불러오기", "공사 관리"]},
    "캘린더":   {"L": ["@title", "이전 달", "오늘", "다음 달", "@seg"], "A": [], "S": "일정 검색", "R": ["@calmgr"]},
    "할 일":    {"L": ["@title", "@tdsum"], "A": [], "S": "할 일 검색", "R": []},
    "업무일지": {"L": ["@title"], "A": [], "S": "사람·내용 검색", "R": ["엑셀", "인쇄"]},
    "업무연락처": {"L": ["@title"], "A": [], "S": "이름·소속·번호 검색", "R": ["엑셀", "프로젝트 관리"]},
    "집행현황": {"L": ["@title", "@year"], "A": ["배치최적화", "@seg:집행액", "@seg:원"], "S": "공사명·업체 검색", "R": ["세부사업 추가", "엑셀"]},
    "예산현황": {"L": ["@title", "@year", "@seg:요약"], "A": ["배치최적화", "@seg:원"], "S": "세부사업 검색", "R": ["엑셀"]},
    "설정":     {"L": ["@title"], "A": [], "S": "설정 검색", "R": ["기본값으로 되돌리기", "설정 닫기"]},
}

ONE = {
    "탐색기":   {"L": [["트리보기", "두칸보기", "네칸보기"], ["펼쳐보기", "미리보기", "숨긴파일"]],
                "R": [["배치복구", "새로고침", "같은폴더", "창바꾸기", "이름변경"], ["@search"]], "S": "파일 검색"},
    "민원대장": {"L": [["@chips"]], "R": [["배치최적화"], ["엑셀"], ["분류 관리"], ["@search"]], "S": "위치·내용·민원인 검색", "typed": "봉일천"},
    "민원처리": {"L": [["@title"]], "R": [["신문고 열기", "민원 불러오기"], ["공사 관리"], ["@search"]], "S": "접수번호·위치·내용 검색"},
    "캘린더":   {"L": [["오늘", "이전 달", "다음 달"], ["@title"], ["@seg"]], "R": [["@calmgr"], ["@search"]], "S": "일정 검색"},
    "할 일":    {"L": [["@title"]], "R": [["@search"]], "S": "할 일 검색", "hide": [".td-summary"]},
    "업무일지": {"L": [["@title"]], "R": [["엑셀", "인쇄"], ["@search"]], "S": "사람·내용 검색"},
    "업무연락처": {"L": [["@title"]], "R": [["엑셀"], ["프로젝트 관리"], ["@search"]], "S": "이름·소속·번호 검색"},
    "집행현황": {"L": [["@title"], ["@year"]], "R": [["@seg:집행액", "@seg:원", "배치최적화"], ["세부사업 추가"], ["엑셀"], ["@search"]], "S": "공사명·업체 검색"},
    "예산현황": {"L": [["@title"], ["@year"], ["@seg:요약"]], "R": [["@seg:원", "배치최적화"], ["엑셀"], ["@search"]], "S": "세부사업 검색"},
    "설정":     {"L": [["@title"]], "R": [["기본값으로 되돌리기"], ["@search"], ["설정 닫기"]], "S": "설정 검색"},
}
SIX = {  # 23:56 사용자 바로잡음: 입력창 단추 → 검색 → 엑셀(맨 오른쪽)
    "민원대장": {"L": [], "R": [["분류 관리", "@search", "엑셀"]], "orig": True},
    "민원처리": {"L": [], "R": [["공사 관리", "@search"]], "orig": True},
    "업무일지": {"L": [], "R": [["@search", "엑셀"]], "orig": True},
    "업무연락처": {"L": [], "R": [["프로젝트 관리", "@search", "엑셀"]], "orig": True},
    "집행현황": {"L": [], "R": [["세부사업 추가", "@search", "엑셀"]], "orig": True},
    "예산현황": {"L": [], "R": [["@search", "엑셀"]], "orig": True},
}
if P.get("six"):
    SPEC = SIX
elif P.get("one"):
    SPEC = ONE
elif P.get("groups"):
    SPEC = GROUPS

CSS = """
#tb{position:absolute;z-index:50;display:grid;align-items:center;height:34px}
#tb .z{display:flex;align-items:center;gap:var(--g)}
#tb .zr{justify-content:flex-end}
#tb h1{margin:0}
#tb .bd-year{margin-left:0}
#tb .search{width:var(--sw);max-width:none;flex:none}
#tb .fx-search{width:var(--sw)}
/* 토글 한 부품 */
#tb .tseg{display:inline-flex;align-items:center;flex:none}
#tb .tseg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;padding:0 12px;cursor:pointer}
#tb .tseg button.on{background:var(--accent);color:var(--on-accent);font-weight:700}
#tb .tseg.box{height:34px;box-sizing:border-box;padding:3px;gap:2px;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-side)}
#tb .tseg.box button{height:26px;border-radius:var(--radius-sm)}
#tb .tseg.flat{height:28px;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;background:var(--surface);overflow:hidden}
#tb .tseg.flat button{height:26px;border-radius:0}
#tb .tseg.flat button+button{border-left:1px solid var(--line)}
#tb .tseg.flat button.on+button,#tb .tseg.flat button+button.on{border-left-color:var(--accent)}
"""

JS = r"""
([spec, P, css, label]) => {
const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
const side=document.querySelector('.side'); const sx=side?side.getBoundingClientRect().right:0;
const inBand=(el)=>{const r=el.getBoundingClientRect(); return r.width&&r.height&&r.top<80&&r.bottom>10&&r.left>=sx-1;};
const all=[...document.querySelectorAll('h1.title,button,label,.search,.bd-year,.bd-unit,.cal-views,.td-summary')].filter(inBand);
const txt=(el)=>((el.getAttribute('aria-label')||'')+' '+(el.innerText||'')).replace(/\s+/g,' ').trim();
const byText=(t)=>all.find(el=>el.tagName==='BUTTON'&&(txt(el).startsWith(t)||(el.getAttribute('aria-label')||'')===t||(el.innerText||'').trim().startsWith(t)));
// 지금 머리 줄 범위(왼쪽·오른쪽 끝)
let x0=1e9,x1=0; for(const el of all){const r=el.getBoundingClientRect(); if(el.matches('.cal-manage')||/(^| )jcal/.test(el.className||'')) continue; if(r.top>40) continue; x0=Math.min(x0,r.left); x1=Math.max(x1,r.right);}
if(label!=='캘린더') x0=sx+28;
const keepH=(el)=>{const p=el.parentElement; if(p&&!p.dataset.kh){p.style.minHeight=p.getBoundingClientRect().height+'px'; p.dataset.kh=1;}};
const mkSeg=(src)=>{const btns=[...src.querySelectorAll('button')]; const s=document.createElement('span'); s.className='tseg '+(P.seg); s.setAttribute('role','radiogroup');
  for(const b of btns){const n=document.createElement('button'); n.type='button'; n.textContent=b.innerText.trim();
   const on=b.getAttribute('aria-pressed')==='true'||b.getAttribute('aria-checked')==='true'||b.classList.contains('on'); if(on) n.className='on'; s.appendChild(n);} return s;};
const segs=all.filter(el=>el.matches('.bd-unit,.cal-views'));
const get=(name)=>{
 if(name==='@title'){const h=all.find(el=>el.matches('h1.title')); if(h) return h; return null;}
 if(name==='@year') return all.find(el=>el.matches('.bd-year'));
 if(name==='@tdsum') return all.find(el=>el.matches('.td-summary'));
 if(name==='@chips'){const c=document.querySelector('.pchip'); if(!c) return null; const w=c.parentElement; keepH(w); w.style.margin='0'; w.style.padding='0'; return w;}
 if(name.startsWith('@seg')){const k=name.split(':')[1]; const s=k?segs.find(x=>x.innerText.trim().startsWith(k)):segs[0]; if(!s) return null; keepH(s); const n=mkSeg(s); s.style.visibility='hidden'; return n;}
 if(name==='@calmgr'){const b=all.find(el=>el.matches('.cal-manage')); if(!b) return null; b.style.visibility='hidden';
   const n=document.createElement('button'); n.type='button'; n.className='btn btn-ctrl btn-text'; n.textContent='종류 관리'; return n;}
 return byText(name)||null;};
const miss=[];
const zone=(names,cls)=>{const z=document.createElement('div'); z.className='z '+(cls||'');
 for(const n of names){const el=get(n); if(!el){miss.push(n); continue;} if(el.parentElement) keepH(el); z.appendChild(el);} return z;};
// 검색: 탐색기는 자기 것(자세히 ▾), 나머지는 같은 모양으로 새로
let search=all.find(el=>el.matches('.search,.set-find'));
let S;
if(spec.orig&&search){keepH(search); S=search;}
else if(search&&search.matches('.fx-search')){keepH(search); S=search; const i=S.querySelector('input'); if(i) i.placeholder=spec.S;}
else{ if(search){keepH(search); search.style.visibility='hidden';}
  S=document.createElement('label'); S.className='search';
  S.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg><input type="text">';
  const i=S.querySelector('input'); i.placeholder=spec.S; i.setAttribute('aria-label',spec.S);
  if(spec.typed){i.value=spec.typed; const x=document.createElement('button'); x.type='button'; x.className='search-x'; x.setAttribute('aria-label','검색어 지우기');
   x.innerHTML='<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>'; S.appendChild(x);} }
const tb=document.createElement('div'); tb.id='tb';
tb.style.setProperty('--g',P.gap+'px'); tb.style.setProperty('--sw',(label==='탐색기'?P.search_explorer:P.search)+'px');
tb.style.left=x0+'px'; tb.style.width=(x1-x0)+'px'; tb.style.top='24px'; tb.style.columnGap=P.gap+'px';
for(const h of (spec.hide||[])) for(const e of document.querySelectorAll(h)) e.style.visibility='hidden';
if(P.groups){
  const gz=(groups)=>{const z=document.createElement('div'); z.className='z'; z.style.gap=P.ggap+'px';
    for(const g of groups){const gg=document.createElement('div'); gg.className='z';
      for(const n of g){ if(n==='@search'){gg.appendChild(S); continue;} const el=get(n); if(!el){miss.push(n); continue;} if(el.parentElement) keepH(el); gg.appendChild(el);}
      z.appendChild(gg);} return z;};
  tb.style.display='flex'; tb.style.justifyContent='space-between'; tb.style.columnGap=P.ggap+'px';
  tb.append(gz(spec.L),gz(spec.R));
  document.body.appendChild(tb);
  if(spec.orig){for(const el of all){ if(!tb.contains(el)&&!/(^| )jcal/.test(el.className||'')) el.style.visibility='hidden'; } for(const e of document.querySelectorAll('.cm-top > *, .ct-head > *')) if(!tb.contains(e)) e.style.visibility='hidden';}
  const ft=document.querySelector('.fx-tools'); if(ft) ft.style.visibility='hidden';
  return {miss, x0, x1, over: tb.scrollWidth>tb.clientWidth+1};
}
const L=zone(spec.L), A=zone(spec.A), R=zone(spec.R,'zr');
// 제목 뒤는 16(8 + h1 오른쪽 8)
if(P.center){ // 왼쪽 칸 [L ... A] | 검색 | 오른쪽 칸 [R]
  tb.style.gridTemplateColumns='minmax(max-content,1fr) auto minmax(max-content,1fr)';
  const left=document.createElement('div'); left.className='z'; left.style.justifyContent='space-between'; left.appendChild(L); left.appendChild(A);
  tb.append(left,S,R);
}else{ // [L] 빈 곳 [A 검색 R]
  tb.style.gridTemplateColumns='max-content 1fr max-content';
  const right=document.createElement('div'); right.className='z'; right.append(A,S,R);
  tb.append(L,document.createElement('span'),right);
}
document.body.appendChild(tb);
// 원래 머리 줄 빈 자리 숨김
const r=tb.getBoundingClientRect();
return {miss, x0, x1, w:r.width, over: tb.scrollWidth>tb.clientWidth+1,
 items:[...tb.querySelectorAll('h1,button,label,.bd-year,.tseg,.td-summary,.pchip')].filter(e=>!e.parentElement.closest('.tseg,.search,.bd-year,.fx-search')).map(e=>{const q=e.getBoundingClientRect(); return {t:(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,14),x:Math.round(q.left),w:Math.round(q.width),y:Math.round(q.top),h:Math.round(q.height)}})};
}
"""

async def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
        for i, (n, spec) in enumerate(SPEC.items()):
            pg = await b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE)
            await pg.add_init_script(SEED)
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            await pg.evaluate("document.fonts.ready.then(()=>1)")
            await pg.locator(".side-item", has_text=n).first.click()
            await pg.wait_for_timeout(900)
            await pg.mouse.move(1599, 899)
            res = await pg.evaluate(JS, [spec, P, CSS, n])
            await pg.evaluate("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            await pg.wait_for_timeout(250)
            img = Image.open(io.BytesIO(await pg.screenshot()))
            sx = int(180 * SCALE)
            img.crop((sx, int(Y0 * SCALE), img.width, int(Y1 * SCALE))).save(os.path.join(OUT, f"{i:02d}.png"))
            report[n] = res
            if res["miss"] or res["over"]:
                print(n, "빠짐", res["miss"], "넘침" if res["over"] else "")
            await pg.close()
        await b.close()
    json.dump(report, open(os.path.join(OUT, "mock.json"), "w"), ensure_ascii=False, indent=1)
    print("ok", PLAN)

asyncio.run(main())
