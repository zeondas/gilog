import { chromium } from 'playwright';
const [f,out,t,act]=process.argv.slice(2);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'});
const p=await b.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto(`http://localhost:4190/harness.html?f=${encodeURIComponent(f)}&t=${encodeURIComponent(t||'어둡게')}`);await p.waitForTimeout(1500);
if(act) await p.evaluate(act);
await p.waitForTimeout(300);
await p.screenshot({path:out,fullPage:true});await b.close();
