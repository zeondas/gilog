# 후보 짝을 실제 요소에 대어 봄(상태 떼고): python3 tools/tidy/pairs_check.py <기준 빌드> <cand.json>
import asyncio, json, sys, re, collections
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'guard'))
import shoot, styles
from playwright.async_api import async_playwright
cand=json.load(open(sys.argv[2]))
STATE=r':(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|invalid|valid|placeholder-shown|visited|link|read-only|indeterminate|empty|target|first-child|last-child|only-child|first-of-type|last-of-type)(?![\w-])'
def strip(s):
    s=re.sub(r'::?(before|after|placeholder|selection|marker|-webkit-[\w-]+)','',s)
    s=re.sub(STATE,'',s)
    s=re.sub(r':not\(\s*\)','',s)
    return s.strip() or '*'
sels=sorted({strip(a) for a,b,_ in cand}|{strip(b.split('|',1)[1]) for a,b,_ in cand})
JS="""(sels)=>{const els=[...document.querySelectorAll('*')];const id=new Map(els.map((e,i)=>[e,i]));const out={};for(const s of sels){try{const m=document.querySelectorAll(s);if(m.length)out[s]=[...m].map(e=>id.get(e));}catch(e){}}return out}"""
async def main():
    srv,port=shoot.serve(sys.argv[1])
    hits=collections.defaultdict(set)
    async with async_playwright() as pw:
        br=await pw.chromium.launch()
        for sc in shoot.SCENES:
            if sc.startswith(('zoom','small')): continue
            try: ctx,p=await styles.open_scene(br,f"http://127.0.0.1:{port}/",sc)
            except Exception as e: print('fail',sc); continue
            r=await p.evaluate(JS,sels)
            for s,ids in r.items(): hits[s].update(f"{sc}#{i}" for i in ids)
            await ctx.close()
        await br.close()
    srv.shutdown()
    real=collections.Counter()
    for a,b,sa in cand:
        sb,bs=b.split('|',1)
        if hits.get(strip(a),set()) & hits.get(strip(bs),set()):
            real[(sa,a,sb,bs)]+=1
    print("같은 요소에 걸리는 짝",len(real))
    for (sa,a,sb,bs),n in sorted(real.items()): print(f"{sa} {a}   ⟵ 원래 뒤에서 덮음 ⟵   {sb} {bs}")
asyncio.run(main())
