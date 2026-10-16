import asyncio, sys, json, io
from PIL import Image
from playwright.async_api import async_playwright
S=sys.argv[1]; OUT=sys.argv[2]
T="2026-10-17"
SEED='''const f=window.__fake;
f.projects=[{id:1,name:"광탄면 배수로 정비",color:null},{id:2,name:"시도15호선 도로정비",color:3},{id:3,name:"방호벽 개선",color:null}];f.nextProjectId=4;
f.contacts=[{id:1,name:"김민수",org:"○○설계",role:"과장",mobile:"010-1234-5678",tel:"",email:"",memo:"",projects:[1,2]},{id:2,name:"이영희",org:"도로관리과",role:"주무관",mobile:"010-2222-3333",tel:"031-940-1234",email:"",memo:"",projects:[3]}];f.nextId=3;
f.complaints=[{id:1,no:1,intake:"전화",received:"2026-10-14",ctype:"포트홀",area:"조리읍",place:"봉일천리 113 일원",person:"홍길동",phone:"010-1111-2222",body:"도로 파임 보수 요청",action:"",due:"2026-10-20",status:"접수",memo:""},{id:2,no:2,intake:"국민신문고",received:"2026-10-10",ctype:"배수불량",area:"문산읍",place:"선유리 22",person:"김철수",phone:"010-3333-4444",body:"배수로 막힘",action:"현장 확인",due:"2026-10-18",status:"처리중",memo:""}];f.nextComplaintId=3;
f.tasks=[{id:1,list:2,parent:null,title:"예산 요구서 작성",detail:"",due:"2026-10-19",done:false,doneOn:""},{id:2,list:2,parent:null,title:"현장 점검 사진 정리",detail:"",due:"",done:false,doneOn:""}];f.nextTaskId=3;
f.events=[{id:1,kind:1,title:"설계 협의",date:"2026-10-17",start:"10:00",end:"11:00",repeat:"",until:"",place:"",note:"",remind:-1,remindTime:""}];f.nextEventId=2;
f.entries=[{id:1,date:"2026-10-17",time:"09:10",kind:"전화",who:"김민수",contact:"010-1234-5678",project:1,lines:[{who:"김민수",me:false,text:"배수로 도면 수정본 보냈어요"},{who:"",me:true,text:"확인하고 연락드릴게요"}],body:""}];f.nextEntryId=2;'''
COLLECT='''()=>{const out=[];const seen=new Set();
for(const el of document.querySelectorAll('button,input,span,a,label,div')){
 const r=el.getBoundingClientRect(); if(r.width<12||r.height<14||r.height>44||r.width>700) continue;
 const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
 const boxy=(cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent')||parseFloat(cs.borderTopWidth)>0;
 if(!boxy) continue;
 let text=el.tagName==='INPUT'?(el.value||el.placeholder):el.innerText; text=(text||'').trim(); if(!text||text.includes('\\n')) continue;
 if(r.top<0||r.bottom>window.innerHeight) continue;
 const k=Math.round(r.x)+','+Math.round(r.y); if(seen.has(k)) continue; seen.add(k);
 out.push({tag:el.tagName,cls:(el.className&&el.className.baseVal===undefined?el.className:'').split(' ').slice(0,2).join(' '),text,x:r.x,y:r.y,w:r.width,h:r.height,bt:parseFloat(cs.borderTopWidth),bb:parseFloat(cs.borderBottomWidth),rad:parseFloat(cs.borderTopLeftRadius)||0});}
return out;}'''
def analyze(img,e):
  m=max(3,int(min(e['rad'],e['h']/2))+2); x0=int(e['x']+0.5)+m; x1=int(e['x']+e['w'])-m
  y0=int(e['y']); y1=int(e['y']+e['h']+0.999)
  bt=int(round(e['bt'])) ; bb=int(round(e['bb']))
  top_edge=int(round(e['y']))+bt; bot_edge=int(round(e['y']+e['h']))-bb  # exclusive
  if x1-x0<4 or bot_edge-top_edge<6: return None
  crop=img.crop((x0,top_edge,x1,bot_edge)).convert('RGB')
  W,H=crop.size; px=crop.load()
  from collections import Counter
  c=Counter(px[i,j] for i in range(0,W,2) for j in range(H)); bg=c.most_common(1)[0][0]
  ink=[j for j in range(H) if any(sum(abs(a-b) for a,b in zip(px[i,j],bg))>90 for i in range(W))]
  if not ink: return None
  return ink[0], H-1-ink[-1]
async def main():
  res=[]
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":1920,"height":1080})
    await pg.goto("http://localhost:5175/"); await pg.wait_for_timeout(1500); await pg.evaluate(SEED)
    await pg.evaluate("document.fonts.load('13px Pretendard','가')"); await pg.wait_for_timeout(500)
    print("font:", await pg.evaluate("document.fonts.check('13px Pretendard','가')"))
    async def grab(name):
      await pg.wait_for_timeout(500)
      await pg.evaluate("document.activeElement&&document.activeElement.blur()")
      img=Image.open(io.BytesIO(await pg.screenshot())); els=await pg.evaluate(COLLECT)
      inOverlay=await pg.evaluate("!!document.querySelector('.overlay')")
      for e in els:
        a=analyze(img,e)
        if a: res.append({"screen":name,"tag":e['tag'],"cls":e['cls'],"text":e['text'],"top":a[0],"bot":a[1],"fy":int(abs(e['y']-round(e['y']))>0.01)})
    async def go(n): await pg.locator(".side-item",has_text=n).first.click(); await pg.wait_for_timeout(700)
    for scr in ["업무일지","민원대장","업무연락처","캘린더","할 일","설정"]:
      await go(scr); await grab(scr)
    await go("업무연락처"); await pg.get_by_role("button",name="프로젝트 관리").click(); await grab("프로젝트 관리"); await pg.keyboard.press("Escape")
    await go("민원대장"); await pg.get_by_role("button",name="분류 관리").click(); await grab("분류 관리"); await pg.keyboard.press("Escape")
    await go("캘린더"); await pg.get_by_role("button",name="관리",exact=True).click(); await grab("종류 관리")
    await pg.get_by_role("button",name="알림 확인").click(); await grab("알림 확인"); await pg.keyboard.press("Escape")
    await b.close()
  json.dump(res,open(OUT,'w'),ensure_ascii=False)
asyncio.run(main())
