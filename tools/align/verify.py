import json,collections,sys
SKIP={'jtel','cal-ev dot'}
for f in sys.argv[1:]:
  r=[x for x in json.load(open(f)) if x['cls'] not in SKIP]
  c=collections.Counter(int(x['top']-x['bot']) for x in r)
  ok=sum(v for k,v in c.items() if k in(-1,0))
  print(f,len(r),'ok',ok,'%.1f%%'%(100*ok/len(r)),sorted(c.items()),'fy',sum(x['fy'] for x in r))
f=sys.argv[-1]; g=collections.defaultdict(list)
for x in json.load(open(f)):
  if x['cls'] in SKIP: continue
  g[(x['tag'],x['cls'])].append(x)
for k,v in g.items():
  d=collections.Counter(int(x['top']-x['bot']) for x in v)
  if not set(d)<={-1,0}: print('  ',k[1][:34].ljust(34),dict(d),'fy',sum(x['fy'] for x in v),[x['text'][:8] for x in v if not -1<=x['top']-x['bot']<=0][:4])
