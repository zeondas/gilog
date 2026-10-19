# 머리 줄 두 줄 시안 (상단 정리 세션, 2026-10-19 23:38 — 사례 분석 규칙)
#   python3 topbar_two.py <폴더> [1|1.25] [light|dark]
# 위 줄 = 제목(+기간 이동) · 오른쪽 화면 동작(넣기 → 엑셀·인쇄 → 관리)
# 아래 줄 = 표 도구: 왼쪽 끝 검색(260, 모든 화면 같은 자리) + 거르기 · 오른쪽 보기 설정(보기 → 단위 → 배치)
# 묶음 안 8, 묶음 사이 16, 줄 사이 12. 앱 코드는 바꾸지 않아요(미리 보기 화면 안에서만 옮김).
import asyncio, io, json, os, sys
from PIL import Image
from playwright.async_api import async_playwright

OUT = sys.argv[1]
SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
THEME = sys.argv[3] if len(sys.argv) > 3 else "light"
URL = os.environ.get("ALIGN_URL", "http://localhost:5175/")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = open(os.path.join(HERE, "seed.js")).read().replace('theme: "light"', f'theme: "{THEME}"')
Y0, Y1 = 8, 150

SPEC = {
    "탐색기": {"t": "탐색기", "r1L": [["@title"]], "r1R": [["새로고침", "같은폴더", "창바꾸기", "이름변경"]],
             "r2L": [["@search"]], "r2R": [["트리보기", "두칸보기", "네칸보기"], ["펼쳐보기", "미리보기", "숨긴파일"], ["배치복구"]], "S": "파일 검색"},
    "민원대장": {"t": "민원대장", "r1L": [["@title"]], "r1R": [["엑셀"], ["분류 관리"]],
             "r2L": [["@search"], ["@chips"]], "r2R": [["배치최적화"]], "S": "위치·내용·민원인 검색", "typed": "봉일천"},
    "민원처리": {"r1L": [["@title"]], "r1R": [["신문고 열기", "민원 불러오기"], ["공사 관리"]],
             "r2L": [["@search"]], "r2R": [], "S": "접수번호·위치·내용 검색"},
    "캘린더": {"r1L": [["오늘", "이전 달", "다음 달"], ["@title"]], "r1R": [["@seg"], ["@calmgr"]],
             "r2L": [["@search"]], "r2R": [], "S": "일정 검색"},
    "할 일": {"r1L": [["@title"]], "r1R": [], "r2L": [["@search"]], "r2R": [], "S": "할 일 검색", "hide": [".td-summary"]},
    "업무일지": {"r1L": [["@title"]], "r1R": [["엑셀", "인쇄"]], "r2L": [["@search"]], "r2R": [], "S": "사람·내용 검색"},
    "업무연락처": {"r1L": [["@title"]], "r1R": [["엑셀"], ["프로젝트 관리"]], "r2L": [["@search"]], "r2R": [], "S": "이름·소속·번호 검색"},
    "집행현황": {"r1L": [["@title"], ["@year"]], "r1R": [["세부사업 추가"], ["엑셀"]],
             "r2L": [["@search"]], "r2R": [["@seg:집행액", "@seg:원"], ["배치최적화"]], "S": "공사명·업체 검색"},
    "예산현황": {"r1L": [["@title"], ["@year"]], "r1R": [["엑셀"]],
             "r2L": [["@search"]], "r2R": [["@seg:요약"], ["@seg:원"], ["배치최적화"]], "S": "세부사업 검색"},
    "설정": {"r1L": [["@title"]], "r1R": [["기본값으로 되돌리기", "설정 닫기"]], "r2L": [["@search"]], "r2R": [], "S": "설정 검색"},
}

CSS = """
#tb{position:absolute;z-index:50;display:flex;flex-direction:column;gap:12px}
#tb .tb-row{display:flex;align-items:center;justify-content:space-between;height:34px;gap:16px}
#tb .tb-zone{display:flex;align-items:center;gap:16px}
#tb .tb-grp{display:flex;align-items:center;gap:8px}
#tb h1{margin:0}
#tb .bd-year{margin-left:0}
#tb .search{width:260px;max-width:none;flex:none}
#tb .tseg{display:inline-flex;align-items:center;flex:none;height:34px;box-sizing:border-box;padding:3px;gap:2px;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-side)}
#tb .tseg button{height:26px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;padding:0 12px}
#tb .tseg button.on{background:var(--accent);color:var(--on-accent);font-weight:700}
"""

JS = r"""
([spec, css, label]) => {
const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
const side=document.querySelector('.side'); const sx=side?side.getBoundingClientRect().right:0;
const inBand=(el)=>{const r=el.getBoundingClientRect(); return r.width&&r.height&&r.top<80&&r.bottom>10&&r.left>=sx-1;};
const all=[...document.querySelectorAll('h1.title,button,label,.search,.bd-year,.bd-unit,.cal-views,.td-summary')].filter(inBand);
const txt=(el)=>((el.getAttribute('aria-label')||'')+' '+(el.innerText||'')).replace(/\s+/g,' ').trim();
const byText=(t)=>all.find(el=>el.tagName==='BUTTON'&&((el.getAttribute('aria-label')||'')===t||(el.innerText||'').trim().startsWith(t)||txt(el).startsWith(t)));
let x0=1e9,x1=0; for(const el of all){const r=el.getBoundingClientRect(); if(el.matches('.cal-manage')||/(^| )jcal/.test(el.className||'')) continue; if(r.top>40) continue; x0=Math.min(x0,r.left); x1=Math.max(x1,r.right);}
if(label!=='캘린더') x0=sx+28;
const rows=new Set();
const take=(el)=>{const p=el.parentElement; if(p){const r=el.getBoundingClientRect(); if(r.top<40) rows.add(p);} return el;};
const mkSeg=(src)=>{const s=document.createElement('span'); s.className='tseg'; s.setAttribute('role','radiogroup');
  for(const b of src.querySelectorAll('button')){const n=document.createElement('button'); n.type='button'; n.textContent=b.innerText.trim();
   if(b.getAttribute('aria-pressed')==='true'||b.getAttribute('aria-checked')==='true'||b.classList.contains('on')) n.className='on'; s.appendChild(n);} return s;};
const segs=all.filter(el=>el.matches('.bd-unit,.cal-views'));
const tools=document.querySelector('.fx-tools'); const toolW=tools?getComputedStyle(tools).getPropertyValue('--tool-w'):'';
let S=null;
const search=all.find(el=>el.matches('.search,.set-find'));
const get=(name)=>{
 if(name==='@title'){const h=all.find(el=>el.matches('h1.title')); if(h) return take(h);
   const n=document.createElement('h1'); n.className='title'; n.textContent=spec.t||label; return n;}
 if(name==='@year'){const y=all.find(el=>el.matches('.bd-year')); return y?take(y):null;}
 if(name==='@chips'){const c=document.querySelector('.pchip'); if(!c) return null; const w=c.parentElement; take(w); w.style.margin='0'; w.style.padding='0'; return w;}
 if(name.startsWith('@seg')){const k=name.split(':')[1]; const s=k?segs.find(x=>x.innerText.trim().startsWith(k)):segs[0]; if(!s) return null; take(s); s.style.display='none'; return mkSeg(s);}
 if(name==='@calmgr'){const b=all.find(el=>el.matches('.cal-manage')); if(b) b.style.visibility='hidden';
   const n=document.createElement('button'); n.type='button'; n.className='btn btn-ctrl btn-text'; n.textContent='종류 관리'; return n;}
 if(name==='@search'){
   if(search&&search.matches('.fx-search')){take(search); const i=search.querySelector('input'); if(i) i.placeholder=spec.S; return search;}
   if(search){take(search); search.style.display='none';}
   const L=document.createElement('label'); L.className='search';
   L.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg><input type="text">';
   const i=L.querySelector('input'); i.placeholder=spec.S; i.setAttribute('aria-label',spec.S);
   if(spec.typed){i.value=spec.typed; const x=document.createElement('button'); x.type='button'; x.className='search-x'; x.setAttribute('aria-label','검색어 지우기');
     x.innerHTML='<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>'; L.appendChild(x);}
   return L;}
 const b=byText(name); return b?take(b):null;};
const miss=[];
const zone=(groups)=>{const z=document.createElement('div'); z.className='tb-zone';
  for(const g of groups){const gg=document.createElement('div'); gg.className='tb-grp';
    for(const n of g){const el=get(n); if(!el){miss.push(n); continue;} gg.appendChild(el);} if(gg.children.length) z.appendChild(gg);} return z;};
for(const h of (spec.hide||[])) for(const e of document.querySelectorAll(h)) e.style.display='none';
const tb=document.createElement('div'); tb.id='tb'; if(toolW) tb.style.setProperty('--tool-w',toolW);
const r1=document.createElement('div'); r1.className='tb-row'; r1.append(zone(spec.r1L),zone(spec.r1R));
const r2=document.createElement('div'); r2.className='tb-row'; r2.append(zone(spec.r2L),zone(spec.r2R));
tb.append(r1,r2);
// 원래 머리 줄 자리를 두 줄 높이(80)로 — 아래 내용이 그만큼 내려가요
for(const p of rows){ if(p.closest('#tb')) continue; p.style.minHeight='80px'; p.style.alignItems='flex-start';}
for(const p of rows){ for(const c of [...p.children]) if(c.matches('.sr-only')) continue; }
tb.style.left=x0+'px'; tb.style.top='24px'; tb.style.width=(x1-x0)+'px';
document.body.appendChild(tb);
const ft=document.querySelector('.fx-tools'); if(ft) ft.style.visibility='hidden';
const over=[r1,r2].some(r=>r.scrollWidth>r.clientWidth+1);
return {miss,x0,x1,over};
}
"""

async def main():
    os.makedirs(OUT, exist_ok=True)
    rep = {}
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
            res = await pg.evaluate(JS, [spec, CSS, n])
            await pg.evaluate("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            await pg.wait_for_timeout(300)
            img = Image.open(io.BytesIO(await pg.screenshot()))
            img.save(os.path.join(OUT, f"full_{i:02d}.png"))
            img.crop((int(180 * SCALE), int(Y0 * SCALE), img.width, int(Y1 * SCALE))).save(os.path.join(OUT, f"{i:02d}.png"))
            rep[n] = res
            if res["miss"] or res["over"]:
                print(n, "빠짐", res["miss"], "넘침" if res["over"] else "")
            await pg.close()
        await b.close()
    json.dump(rep, open(os.path.join(OUT, "two.json"), "w"), ensure_ascii=False, indent=1)
    print("ok")

asyncio.run(main())
