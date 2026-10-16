import sys, json, asyncio, io
from PIL import Image, ImageChops
from playwright.async_api import async_playwright
S=1
COLLECT = r"""
() => {
  const out=[]; let n=0;
  const vis=e=>{const r=e.getBoundingClientRect();if(r.width<4||r.height<4)return null;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.opacity==='0')return null;return r;};
  const boxy=e=>{const cs=getComputedStyle(e);
    const bw=['Top','Right','Bottom','Left'].some(s=>parseFloat(cs['border'+s+'Width'])>0&&cs['border'+s+'Style']!=='none');
    const bg=cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent';
    return e.tagName==='BUTTON'||e.tagName==='INPUT'||e.tagName==='SELECT'||(bw&&cs.borderTopWidth!=='0px'&&cs.borderBottomWidth!=='0px'||bw&&parseFloat(cs.borderLeftWidth)>0&&parseFloat(cs.borderRightWidth)>0)||(bg&&parseFloat(cs.borderRadius)>0)||(bg&&e.closest('[class*=badge],[class*=chip],[class*=pill],[class*=tag]')===e);};
  const els=[...document.querySelectorAll('body *')].filter(e=>!e.closest('svg')&&e.tagName!=='TEXTAREA');
  const hasText=e=>{if(e.tagName==='INPUT')return (e.value||e.placeholder)&&['text','search','password','email','tel',''].includes(e.type);const t=e.innerText;return t&&t.trim().length>0&&!t.trim().includes('\n');};
  for(const e of els){
    const r=vis(e); if(!r||r.height>64||r.width>900||r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth) continue;
    if(!boxy(e)||!hasText(e)) continue;
    {const tp=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); if(!tp||!(tp===e||e.contains(tp))) continue;}
    const fy=Math.abs(r.top-Math.round(r.top))>0.01;
    // leaf: no boxy descendant that also has text
    if(e.tagName!=='INPUT'&&[...e.querySelectorAll('*')].some(d=>!d.closest('svg')&&vis(d)&&boxy(d)&&hasText(d)&&d.getBoundingClientRect().height<r.height-1)) continue;
    const cs=getComputedStyle(e);
    const bt=parseFloat(cs.borderTopWidth),bb=parseFloat(cs.borderBottomWidth),bl=parseFloat(cs.borderLeftWidth),br=parseFloat(cs.borderRightWidth);
    const id='a'+(n++); e.setAttribute('data-audit',id);
    out.push({id,tag:e.tagName,cls:(e.className&&e.className.baseVal===undefined?e.className:'')||'',par:(e.parentElement.className||'').toString().slice(0,40),
      text:(e.tagName==='INPUT'?(e.value||e.placeholder):e.innerText).trim().slice(0,24),
      fy,x:r.left+bl,y:r.top+bt,w:r.width-bl-br,h:r.height-bt-bb,ta:cs.textAlign,jc:cs.justifyContent,disp:cs.display,fs:cs.fontSize,lh:cs.lineHeight,pt:cs.paddingTop,pb:cs.paddingBottom,pl:cs.paddingLeft,pr:cs.paddingRight,ai:cs.alignItems});
  }
  return out;
}"""
HIDE_ICONS="svg,img,canvas{visibility:hidden!important} *{caret-color:transparent!important;transition:none!important;animation:none!important}"
HIDE_TEXT="*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important} *::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important} *::selection{background:transparent!important}"
async def measure(pg, label):
    items=await pg.evaluate(COLLECT)
    s1=await pg.add_style_tag(content=HIDE_ICONS)
    await pg.wait_for_timeout(60)
    a=Image.open(io.BytesIO(await pg.screenshot())).convert("RGB")
    s2=await pg.add_style_tag(content=HIDE_TEXT)
    await pg.wait_for_timeout(60)
    b=Image.open(io.BytesIO(await pg.screenshot())).convert("RGB")
    await pg.evaluate("()=>{document.querySelectorAll('style:not(#xcss)').forEach(s=>{if(s.textContent.includes('caret-color:transparent!important')||s.textContent.includes('-webkit-text-fill-color:transparent!important'))s.remove()})}")
    diff=ImageChops.difference(a,b).convert("L")
    res=[]
    for it in items:
        X,Y,W,H=[round(v*S) for v in (it['x'],it['y'],it['w'],it['h'])]
        if W<=2 or H<=2: continue
        crop=diff.crop((X,Y,X+W,Y+H)); mx=crop.getextrema()[1]
        if mx<25: continue
        bb=crop.point(lambda v,m=mx:255 if v>m*0.3 else 0).getbbox()
        if not bb: continue
        l,t,r,bm=bb
        it.update(top=t/S,bot=(H-bm)/S,left=l/S,right=(W-r)/S,screen=label)
        res.append(it)
    return res
async def run(actions, out, css='', js=''):
    async with async_playwright() as p:
        br=await p.chromium.launch()
        pg=await br.new_page(viewport={"width":1920,"height":1080},device_scale_factor=S)
        pg.set_default_timeout(4000)
        await pg.add_init_script(path="seed.js")
        if css: await pg.add_init_script(script="document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.id='xcss';s.textContent="+json.dumps(css)+";document.head.appendChild(s)})")
        if js: await pg.add_init_script(script="document.addEventListener('DOMContentLoaded',()=>{"+js+"})")
        await pg.goto("http://localhost:5175/"); await pg.wait_for_timeout(800); await pg.evaluate("document.fonts.ready.then(()=>1)")
        allr=[]
        for label, act in actions:
            try:
                await act(pg)
            except Exception as ex:
                print("FAIL",label,str(ex)[:120]); continue
            await pg.wait_for_timeout(400)
            if not label.endswith("*"):
                await pg.mouse.move(1919,1079); await pg.evaluate("()=>document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            await pg.wait_for_timeout(150)
            allr+=await measure(pg,label)
        await br.close()
    json.dump(allr,open(out,"w"),ensure_ascii=False,indent=0)
    return allr
