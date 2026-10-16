// 가운데 정렬로 반 픽셀에 걸친 창을 정수 픽셀로 옮겨요
(()=>{const snap=()=>{document.querySelectorAll('.overlay > *').forEach(d=>{d.style.translate='';const t=d.getBoundingClientRect().top;const f=t-Math.floor(t);if(f>0.01)d.style.translate='0 '+(-f)+'px';});};
new MutationObserver(()=>requestAnimationFrame(snap)).observe(document,{childList:true,subtree:true});})();
