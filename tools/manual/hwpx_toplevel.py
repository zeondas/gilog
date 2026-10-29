import re
def top_paras(sec):
    """section0.xml → [(start,end)] top-level <hp:p> spans (handles nested paragraphs in tables)."""
    out=[];depth=0;start=None
    for m in re.finditer(r'<hp:p\b[^>]*?(/?)>|</hp:p>',sec):
        t=m.group(0)
        if t.startswith('</'):
            depth-=1
            if depth==0: out.append((start,m.end()))
        elif m.group(1)=='/':
            if depth==0: out.append((m.start(),m.end()))
        else:
            if depth==0: start=m.start()
            depth+=1
    return out
def first_vert(p):
    q=re.sub(r'<hp:tbl\b.*?</hp:tbl>','',p,flags=re.S)
    m=re.findall(r'<hp:linesegarray>(.*?)</hp:linesegarray>',q,re.S)
    if not m: return None
    return [int(x) for x in re.findall(r'vertpos="(-?\d+)"',m[-1])]
