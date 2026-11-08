'use strict';
/**
 * Category configs extracted from the generated ThePhysicianAssetStudio tools.
 * Each IIFE owns its own helper closures; the drawing engine is global.
 */
window.AssetCategories = window.AssetCategories || {};

(function () {
const CFG={id:'flyer',title:'Flyer Maker',sub:'Pick a size and a design, add your photo and text, then download or print.',qr:'Link for a QR code (optional)',
sizes:[{n:'A4 portrait',d:'Print · 1240×1754',w:1240,h:1754},{n:'A3 poster',d:'Print · 1754×2480',w:1754,h:2480},{n:'Portrait 4:5',d:'Instagram · 1080×1350',w:1080,h:1350},{n:'Story 9:16',d:'Stories · 1080×1920',w:1080,h:1920}],
fields:[['eyebrow','Small line above'],['title','Headline',2],['sub','Sub-headline'],['date','Date'],['price','Price / offer'],['body','Description',3],['cta','Button text'],['foot','Footer line']],
tpls:[
{n:'Table worth crossing',ph:1,q:1,pi:'prawns',t:{title:'A table worth crossing town for',sub:'Find your cure.',body:'Seasonal plates, a considered drinks list and a room built for long lunches. Join us for dinner, private dining or a quiet drink at the bar.',foot:'129 South Street, St Andrews, KY16 9UH · www.thephysician.bar',cta:'Book a table'},
draw(W,H){const ph=H*.48,p=W*.08,qs=S.qr?W*.19:0;photo(0,0,W,ph);grad(0,0,W,ph*.3,'#000000',.55,0);logoAt(W/2,H*.03,W*.036,'#ffffff','c');
stack([p,ph+H*.035,W-2*p-qs,H-ph-H*.07],[{k:'title',z:92,lh:1.06},{k:'sub',z:44,g:40,ls:.03},{k:'body',z:27,f:'b',c:'mute',g:44,lh:1.4},{k:'foot',z:19,f:'l',c:'mute',g:30,ls:.04},{k:'cta',z:28,f:'l',up:1,ls:.16,g:26}],{al:'l',va:'t'});
if(S.qr)qrAt(W-p-qs,H-H*.04-qs,qs)}},
{n:'Christmas · photo',ph:1,pi:'cocktail',t:{title:'Christmas Brunch',date:'Sunday 13th December',price:'2 courses + cocktail £49',body:'With Decadance DJs, singalongs, confetti & glowsticks'},
draw(W,H){const m=W*.08,ph=H*.56;photo(m,m,W-2*m,ph-m);stack([m,ph+H*.02,W-2*m,H-ph-H*.08],[{k:'title',z:82,up:1,ls:.01,lh:1.05},{k:'date',z:32,f:'l',up:1,ls:.28,g:34},{k:'price',z:42,f:'l',w:700,up:1,g:30},{k:'body',z:21,f:'l',w:600,up:1,ls:.1,g:36}])}},
{n:'Christmas · type',t:{eyebrow:'Decadance Daytime Clubbing',title:'Christmas Brunch',date:'Sunday 13th December',price:'2 courses + cocktail £49',body:'Decadance DJs, Singalongs, Confetti, Glowsticks & More\nWith DJs Vanessa Motion & Chris Jordan',foot:'the adamson | THE PHYSICIAN'},
draw(W,H){const p=W*.09,w=W-2*p;stack([p,H*.08,w,H*.05],[{k:'eyebrow',z:24,f:'l',up:1,ls:.32}],{va:'t'});
stack([p,H*.16,w,H*.54],[{k:'title',z:126,up:1,lh:1.02},{bar:1,h:7,c:'accent',g:44},{k:'date',z:48,f:'l',up:1,ls:.1,g:40},{k:'price',z:46,up:1,w:700,g:18}]);
stack([p,H*.72,w,H*.2],[{k:'body',z:27,f:'l',lh:1.5},{k:'foot',z:32,f:'l',w:600,g:40}],{va:'b'})}},
{n:'Bold colour',q:1,t:{eyebrow:'Sunday sessions',title:'Dinner, served properly.',sub:'Find your cure.',date:'',body:'Book a table for Sunday lunch or dinner.',cta:'Book a table',foot:'www.thephysician.bar'},
draw(W,H){const p=W*.08,qs=S.qr?W*.2:0,on=accentTextColor();R(0,0,W,H,'accent');logoAt(p,H*.05,W*.04,on,'l');rod(W-p-W*.03,H*.045,H*.1,on,W*.004);
stack([p,H*.28,W-2*p-qs,H*.66],[{k:'eyebrow',z:26,f:'l',up:1,ls:.25,c:on},{k:'title',z:128,lh:1.02,g:30,c:on},{k:'sub',z:44,g:30,c:on},{k:'date',z:34,f:'l',up:1,ls:.14,g:30,c:on},{k:'body',z:28,f:'b',g:36,c:on},{k:'cta',z:30,f:'l',up:1,ls:.16,g:40,c:on},{k:'foot',z:20,f:'l',g:24,ls:.05,c:on}],{al:'l',va:'b'});
if(S.qr)qrAt(W-p-qs,H*.94-qs,qs)}},
{n:'Night photo',ph:1,q:1,pi:'beef',t:{eyebrow:'Chef’s special',title:'Dry-aged beef, bone marrow',date:'',price:'£34',body:'Charcoal-grilled, watercress, roast shallot and a red wine jus.',cta:'Book a table',foot:'129 South Street, St Andrews · www.thephysician.bar'},
draw(W,H){const p=W*.08,qs=S.qr?W*.2:0,cr='#f6f1ea';photo(0,0,W,H);grad(0,H*.12,W,H*.88,'#0e0e1a',0,.97);grad(0,H*.4,W,H*.6,'#0e0e1a',0,.6);logoAt(p,H*.04,W*.036,cr,'l');
stack([p,H*.38,W-2*p-qs,H*.53],[{k:'eyebrow',z:26,f:'l',up:1,ls:.25,c:cr},{k:'title',z:112,lh:1.04,g:26,c:cr},{k:'price',z:56,g:24,c:cr},{k:'date',z:32,f:'l',up:1,ls:.14,g:20,c:cr},{k:'body',z:28,f:'b',g:30,c:cr,lh:1.4},{k:'cta',z:28,f:'l',up:1,ls:.16,g:36,c:cr},{k:'foot',z:19,f:'l',g:22,ls:.04,c:'#c9c3ba'}],{al:'l',va:'b'});
if(S.qr)qrAt(W-p-qs,H*.95-qs,qs)}}]};
window.AssetCategories['flyer'] = CFG;
})();

(function () {
const IT1='Oysters, shallot vinegar | Six, shucked to order | £18\nCured salmon, dill oil | Rye, pickled cucumber | £12\nDry-aged beef, bone marrow | Charcoal-grilled, watercress | £34\nWild mushroom tart | Truffle, aged parmesan | £22\nNegroni | Gin, vermouth, bitter orange | £11';
const IT2='Truffle risotto | Carnaroli rice, wild mushrooms, parmesan crisps, chives | £28\nPan-seared duck breast | Spiced red cabbage, duck fat potatoes, cherry reduction | £34\nChocolate orange tart | Dark chocolate ganache, Cointreau, mandarin sorbet, hazelnuts | £14';
const IT3='#Small plates\nOysters, shallot vinegar | Six, shucked to order | £18\nCured salmon, dill oil | Rye, pickled cucumber | £12\n#Mains\nDry-aged beef, bone marrow | Charcoal-grilled, watercress | £34\nWild mushroom tart | Truffle, aged parmesan | £22\n#Drinks\nNegroni | Gin, vermouth, bitter orange | £11';
const FT='129 South Street, St Andrews, KY16 9UH · www.thephysician.bar';
const CFG={id:'menu',title:'Menu Maker',sub:'Type your dishes, one per line, and the layout does the rest.',
sizes:[{n:'A4 portrait',d:'Print · 1240×1754',w:1240,h:1754},{n:'Slim DL',d:'Print · 827×1748',w:827,h:1748},{n:'Story 9:16',d:'Digital · 1080×1920',w:1080,h:1920}],
fields:[['sub','Small label'],['title','Title'],['items','Items — one per line: Name | Description | Price\nStart a line with # for a section heading',9],['foot','Footer line']],
tpls:[
{n:'Classic',t:{sub:'Menu',title:'The Physician menu',items:IT1,foot:FT},
draw(W,H){const p=W*.09,w=W-2*p;R(p,H*.07,w,H*.011,'accent');stack([p,H*.11,w,H*.22],[{logo:36},{k:'sub',z:24,f:'l',up:1,ls:.3,g:56},{k:'title',z:84,g:14},{bar:1,w:.38,h:9,c:'accent',g:34}],{va:'t'});
menuList([p,H*.35,w,H*.52],{zn:46,zd:28,zp:46,g:66,zh:22});stack([p,H*.88,w,H*.03],[{k:'foot',z:19,f:'l',c:'mute',ls:.04}],{va:'b'})}},
{n:'Festive',t:{title:'Festive Menu',items:IT2,foot:'Two courses £49 · Sunday 13th December'},
draw(W,H){const p=W*.09,w=W-2*p;R(p,H*.05,w,H*.011,'accent');stack([p,H*.09,w,H*.12],[{k:'title',z:84,up:1,w:700}]);
menuList([p,H*.26,w,H*.60],{zn:50,wn:700,up:1,zd:30,zp:46,g:96,zh:22});stack([p,H*.88,w,H*.03],[{k:'foot',z:21,f:'l',up:1,ls:.16,c:'mute'}],{va:'b'})}},
{n:'Centred',t:{sub:'Dinner',title:'Seasonal plates',items:IT3,foot:FT},
draw(W,H){const p=W*.1,w=W-2*p;stack([p,H*.05,w,H*.2],[{logo:34},{k:'sub',z:22,f:'l',up:1,ls:.3,g:46},{k:'title',z:70,g:12}],{va:'t'});
menuList([p,H*.26,w,H*.60],{al:'c',zn:50,zd:28,zp:38,g:58,zh:22});stack([p,H*.88,w,H*.03],[{k:'foot',z:18,f:'l',c:'mute',ls:.04}],{va:'b'})}},
{n:'Photo header',ph:1,pi:'prawns',t:{title:'Sharing plates',items:IT1,foot:FT},
draw(W,H){const p=W*.09,w=W-2*p,ph=H*.27;photo(0,0,W,ph);grad(0,0,W,ph*.5,'#000000',.55,0);logoAt(W/2,H*.03,W*.04,'#ffffff','c');
stack([p,ph+H*.025,w,H*.1],[{k:'title',z:72},{bar:1,w:.3,h:8,c:'accent',g:20}],{al:'l',va:'t'});menuList([p,ph+H*.13,w,H*.47],{zn:38,zd:24,zp:38,g:54,zh:22,top:1});stack([p,H*.88,w,H*.03],[{k:'foot',z:18,f:'l',c:'mute',ls:.04}],{va:'b'})}}]};
window.AssetCategories['menu'] = CFG;
})();

(function () {
const AD='129 South Street, St Andrews, KY16 9UH · www.thephysician.bar',TM='Redeemable at this venue. Valid for 12 months from purchase. Not exchangeable for cash.';
function codeBox(x,y,s,inner,box,code){const fill=box||'ink',ink=code||'accent';R(x,y,s,s,fill);if(inner){X.strokeStyle=C(ink);X.lineWidth=Math.max(2,s*.006);X.strokeRect(x+s*.035,y+s*.035,s*.93,s*.93)}
if(S.qr)qrAt(x+s*.12,y+s*.12,s*.76);else put(T('code'),x+s/2,y+s/2,fnt('l',400,s*.085),s*.012,'c',C(ink))}
const cream=(n,deco,t)=>({n,q:1,t,draw(W,H){const p=W*.08,s=Math.min(H*.48,W*.23),sw=W*.18;R(0,0,W,H,'paper');R(0,0,sw,H,'accent');
deco?sprig(sw/2,H*.5,H*.62,C('paper'),C('ink')):rod(sw/2,H*.12,H*.76,C('paper'),W*.004);
stack([sw+p,H*.1,W-sw-2*p-s-p,H*.8],[{logo:30},{k:'eyebrow',z:20,f:'l',up:1,ls:.2,g:40},{k:'amount',z:118,g:6},{k:'to',z:26,g:20},{k:'msg',z:22,f:'b',c:'mute',g:10,lh:1.35},{k:'terms',z:13,f:'b',c:'mute',g:26,lh:1.4},{k:'foot',z:12,f:'l',c:'mute',g:10}],{al:'l',va:'t'});
codeBox(W-p-s,H-p-s,s,1,'ink','paper')}});
const CFG={id:'voucher',title:'Gift Voucher Maker',sub:'Set the amount, the message and the code. Download and print or send.',qr:'Link for a QR code (optional – replaces the code text)',
sizes:[{n:'Wide card',d:'Print · 2480×1169',w:2480,h:1169},{n:'A5 landscape',d:'Print · 1748×1240',w:1748,h:1240},{n:'Digital 16:9',d:'Email · 1600×900',w:1600,h:900}],
fields:[['eyebrow','Label'],['amount','Amount'],['to','To / From'],['msg','Message',2],['terms','Terms',3],['foot','Address line'],['code','Voucher code']],
tpls:[
{n:'Brand accent',q:1,t:{eyebrow:'Gift voucher',amount:'£50',to:'',msg:'',terms:TM,foot:AD,code:'GIFT-0001'},
draw(W,H){const p=W*.08,s=Math.min(H*.56,W*.25),on=accentTextColor();R(0,0,W,H,'accent');logoAt(p,H*.1,W*.032,on,'l');
stack([p,H*.3,W-2*p-s-W*.05,H*.6],[{k:'eyebrow',z:22,f:'l',up:1,ls:.18,c:on},{k:'amount',z:118,g:24,c:on},{k:'to',z:26,g:16,c:on},{k:'msg',z:22,f:'b',g:8,lh:1.35,c:on},{k:'terms',z:14,f:'b',g:36,lh:1.4,c:on},{k:'foot',z:12,f:'l',g:12,ls:.03,c:on}],{al:'l',va:'t'});codeBox(W-p-s,(H-s)/2,s,0,on,'accent')}},
{n:'Secret Santa',q:1,t:{eyebrow:'Secret Santa voucher',amount:'£50',to:'',msg:'',code:'SANTA-0001'},
draw(W,H){const p=W*.08,s=Math.min(H*.72,W*.36),on=accentTextColor();R(0,0,W,H,'accent');stack([p,H*.1,W-2*p-s-W*.05,H*.8],[{k:'eyebrow',z:34,f:'l',up:1,ls:.22,c:on},{k:'amount',z:190,c:on,g:20},{k:'to',z:28,c:on,g:10},{k:'msg',z:24,f:'b',c:on,g:10}],{al:'l'});codeBox(W-p-s,(H-s)/2,s,1,on,'accent')}},
cream('Cream classic',0,{eyebrow:'Gift voucher',amount:'£50',to:'',msg:'',terms:TM,foot:AD,code:'GIFT-0001'}),
cream('Christmas sprig',1,{eyebrow:'Season’s greetings',amount:'£50',to:'',msg:'Find your cure this Christmas.',terms:TM,foot:AD,code:'XMAS-0001'})]};
window.AssetCategories['voucher'] = CFG;
})();

(function () {
const BC={name:'Your name',role:'General Manager',phone:'01334 479191',email:'reservations@theadamson.com',address:'129 South Street, St Andrews, KY16 9UH',web:'www.thephysician.bar',handle:'@thephysician_standrews',tag:'Find your cure.'};
function back(W,H,bg,fg,mu,lg){const p=W*.08;R(0,0,W,H,bg);logoAt(W-p,p*.85,W*.03,C(lg),'r');
stack([p,p*.85,W*.55,H*.3],[{k:'name',z:62,c:fg},{k:'role',z:24,f:'l',up:1,ls:.12,g:14,c:fg}],{al:'l',va:'t'});
stack([p,H*.42,W*.6,H*.5],['phone','email','address','web','handle'].map((k,i)=>({k,z:27,f:'b',c:i<2?fg:mu,g:i?H/U*.04:0})),{al:'l',va:'t'});
if(S.qr){const s=H*.3;qrAt(W-p-s,H-p-s,s)}}
const CFG={id:'bizcard',title:'Business Card Maker',sub:'Front and back, 85×55 mm. Enter your details and download.',qr:'Link for a QR code on the back (optional)',thumb:2,
sizes:[{n:'Front',d:'1004×650',w:1004,h:650,side:'f'},{n:'Back',d:'1004×650',w:1004,h:650,side:'b'},{n:'Both sides',d:'One image · 1004×1340',w:1004,h:1340,sides:2}],
fields:[['name','Name'],['role','Job title'],['phone','Phone'],['email','Email'],['address','Address'],['web','Website'],['handle','Instagram'],['tag','Tagline']],
tpls:[
{n:'Brand accent',q:1,t:{...BC},draw(W,H,s){if(s==='b')return back(W,H,'paper','ink','mute','ink');const on=accentTextColor();R(0,0,W,H,'accent');rod(W/2,H*.16,H*.34,on,H*.009);
stack([W*.1,H*.55,W*.8,H*.1],[{k:'tag',z:26,f:'l',up:1,ls:.18,c:on}]);R(W*.09,H*.675,W*.82,H*.013,on);stack([W*.1,H*.76,W*.8,H*.08],[{k:'web',z:22,f:'l',ls:.2,c:on}])}},
{n:'Cream & accent',q:1,t:{...BC},draw(W,H,s){const on=accentTextColor();if(s==='b')return back(W,H,'accent',on,on,on);logoAt(W/2,H*.36,W*.06,C('ink'),'c');stack([W*.1,H*.58,W*.8,H*.1],[{k:'tag',z:22,f:'l',up:1,ls:.2,c:'mute'}]);R(W*.46,H*.74,W*.08,H*.012,'accent')}},
{n:'Photo front',ph:1,q:1,pi:'beef',t:{...BC},draw(W,H,s){if(s==='b')return back(W,H,'paper','ink','mute','ink');photo(0,0,W,H);grad(0,0,W,H,'#0e0e1a',.5,.8);logoAt(W/2,H*.38,W*.06,'#f6f1ea','c');stack([W*.1,H*.6,W*.8,H*.1],[{k:'tag',z:22,f:'l',up:1,ls:.2,c:'#f6f1ea'}])}}]};
window.AssetCategories['bizcard'] = CFG;
})();

(function () {
const CFG={id:'tablecard',title:'Table Card Maker',sub:'Specials, greetings, QR menus and reserved cards for the tables.',qr:'Link for the QR code (menu or booking page)',
sizes:[{n:'A5 portrait',d:'Print · 1240×1748',w:1240,h:1748},{n:'Square',d:'Print · 1200×1200',w:1200,h:1200}],
fields:[['eyebrow','Small label'],['title','Headline',2],['sub','Sub-line'],['body','Description',3],['price','Price'],['date','Time / date'],['foot','Footer line']],
tpls:[
{n:'Chef’s special',t:{eyebrow:'Chef’s special',title:'Dry-aged beef, bone marrow',body:'Charcoal-grilled, watercress, roast shallot and a red wine jus.',price:'£34',foot:'Ask the team about allergens. Available while the kitchen is open.'},
draw(W,H){const p=W*.1,w=W-2*p;R(p,H*.07,w,H*.01,'accent');logoAt(W/2,H*.13,W*.045,C('ink'),'c');stack([p,H*.25,w,H*.57],[{k:'eyebrow',z:26,f:'l',up:1,ls:.28},{k:'title',z:78,g:60,lh:1.08},{k:'body',z:28,f:'b',c:'mute',g:56,lh:1.4},{k:'price',z:66,g:60}]);stack([p,H*.82,w,H*.06],[{k:'foot',z:19,f:'b',c:'mute'}],{va:'b'})}},
{n:'Season’s greetings',t:{title:'Season’s Greetings',sub:'Find your cure.'},
draw(W,H){const p=W*.1,sh=Math.min(H*.4,W*.6);sprig(W/2,H*.12+sh*.5,sh,C('ink'),C('accent'));stack([p,H*.12+sh+H*.05,W-2*p,H*.2],[{k:'title',z:76,lh:1.1},{k:'sub',z:22,f:'l',up:1,ls:.24,g:34}],{va:'t'})}},
{n:'Scan for the menu',q:1,t:{eyebrow:'Menu & booking',title:'Scan to see the menu',foot:'www.thephysician.bar'},
draw(W,H){const p=W*.1,w=W-2*p,s=Math.min(W*.5,H*.34);R(p,H*.06,w,H*.01,'accent');logoAt(W/2,H*.11,W*.04,C('ink'),'c');stack([p,H*.2,w,H*.2],[{k:'eyebrow',z:24,f:'l',up:1,ls:.28},{k:'title',z:68,g:28,lh:1.1}],{va:'t'});
qrAt(W/2-s/2,H*.45,s,1);stack([p,H*.45+s+H*.03,w,H*.08],[{k:'foot',z:22,f:'l',ls:.12,c:'mute'}],{va:'t'})}},
{n:'Reserved',t:{title:'Reserved',sub:'Name of party',date:'7:30 pm'},
draw(W,H){const p=W*.1;R(0,H*.93,W,H*.07,'accent');rod(W/2,H*.08,H*.2,C('accent'),W*.004);stack([p,H*.34,W-2*p,H*.5],[{k:'title',z:118,up:1,ls:.02},{bar:1,w:.2,h:7,c:'accent',g:40},{k:'sub',z:38,g:40},{k:'date',z:26,f:'l',up:1,ls:.24,c:'mute',g:30}])}}]};
window.AssetCategories['tablecard'] = CFG;
})();

(function () {
const CFG={id:'social',title:'Social Post Maker',sub:'Instagram posts, portraits and stories in the Physician look.',
sizes:[{n:'Square',d:'Post · 1080×1080',w:1080,h:1080},{n:'Portrait 4:5',d:'Feed · 1080×1350',w:1080,h:1350},{n:'Story 9:16',d:'Stories · 1080×1920',w:1080,h:1920}],
fields:[['eyebrow','Small line'],['title','Headline',2],['sub','Sub-headline'],['date','Date'],['price','Price / offer'],['cta','Button text'],['foot','Footer line']],
tpls:[
{n:'Statement',t:{title:'Dinner, served properly.',sub:'Find your cure.',foot:'@thephysician_standrews · www.thephysician.bar'},
draw(W,H){const p=W*.08;R(0,0,W,H*.015,'accent');stack([p,H*.08,W-2*p,H*.8],[{logo:50},{sp:1,g:H/U*.16},{k:'title',z:108,lh:1.06},{k:'sub',z:30,f:'l',up:1,ls:.16,g:60}]);stack([p,H*.84,W-2*p,H*.07],[{k:'foot',z:25,f:'b',c:'mute'}],{va:'b'})}},
{n:'Chef’s special',ph:1,pi:'beef',t:{eyebrow:'Chef’s special',title:'Dry-aged beef, bone marrow',price:'£34',foot:'Charcoal-grilled · watercress · red wine jus'},
draw(W,H){const ph=H*(H<=W?.5:.46),p=W*.08;photo(0,0,W,ph);stack([p,ph+H*.03,W-2*p,H-ph-H*.09],[{k:'eyebrow',z:24,f:'l',up:1,ls:.3},{k:'title',z:78,lh:1.1,g:34},{k:'price',z:40,c:'accent',g:24},{k:'foot',z:21,f:'b',c:'mute',g:24}])}},
{n:'Sunday sessions',ph:1,pi:'duck',t:{title:'Sunday Sessions',cta:'Book a table',foot:'www.thephysician.bar'},
draw(W,H){const ph=H*(H<=W?.5:.46),p=W*.08;photo(0,0,W,ph);stack([p,ph+H*.03,W-2*p,H-ph-H*.09],[{k:'title',z:118,w:700,lh:1.05},{k:'cta',z:25,f:'l',up:1,ls:.24,g:56},{k:'foot',z:20,f:'b',c:'mute',g:22}])}},
{n:'Christmas icon',t:{title:'Christmas Brunch',date:'Sunday 13th December',price:'2 courses + cocktail £49'},
draw(W,H){const p=W*.06,gh=Math.min(H*.34,W*.5);glass(W/2,H*.5-gh*.95-H*.02,gh,C('ink'),C('accent'));stack([p,H*.52,W-2*p,H*.4],[{k:'title',z:104,up:1,lh:1.04},{k:'date',z:32,f:'l',up:1,ls:.28,g:40},{k:'price',z:32,f:'l',up:1,ls:.04,c:accentTextColor(),bg:'accent',g:50}],{va:'t'})}},
{n:'Announcement',t:{eyebrow:'New on the menu',title:'The Sunday roast is back.',sub:'Every Sunday from 12',foot:'Book at www.thephysician.bar'},
draw(W,H){const p=W*.09,on=accentTextColor();R(0,0,W,H,'accent');rod(W/2,H*.07,H*.17,on,W*.004);stack([p,H*.28,W-2*p,H*.6],[{k:'eyebrow',z:26,f:'l',up:1,ls:.26,c:on},{k:'title',z:118,lh:1.04,g:36,c:on},{k:'sub',z:34,c:on,g:36}]);stack([p,H*.85,W-2*p,H*.06],[{k:'foot',z:22,f:'l',up:1,ls:.14,c:on}],{va:'b'})}}]};
window.AssetCategories['social'] = CFG;
})();

/* =====================================================================
 * Post ideas — a menu item becomes a finished social post.
 * Two layouts that follow the shape of a good dish post: the photograph
 * carries the mood, the band underneath carries the dish and its price,
 * and the caption (written in the Caption tab) finishes the job.
 * ===================================================================== */
(function () {
    // The band is always the darker of ink/paper so the same layout reads on
    // a dark brand and a light one; `light` is its readable partner.
    function bandColours() {
        const ink = C('ink');
        const paper = C('paper');
        return colorLuma(ink) <= colorLuma(paper)
            ? { dark: ink, light: paper }
            : { dark: paper, light: ink };
    }

    function pill(text, x, centreY, size, bg, fg, font) {
        if (!String(text || '').trim()) return 0;
        X.font = font;
        const height = size * 2.1;
        const width = tw(text, font, 0) + size * 2.2;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(x, centreY - height / 2, width, height, height / 2);
        X.fill();
        put(text, x + size * 1.1, centreY + 1, font, 0, 'l', fg);
        return width;
    }

    function badge(text, x, y, size, bg, fg) {
        if (!String(text || '').trim()) return;
        X.font = fnt('l', 700, size);
        const height = size * 2.4;
        const width = tw(text, X.font, size * 0.16) + size * 2.4;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(x, y, width, height, height / 2);
        X.fill();
        put(text, x + size * 1.2, y + height / 2 + 1, X.font, size * 0.16, 'l', fg);
    }

    // The handle/location block, right aligned, one line per `\n`.
    function credits(text, right, bottomY, size, color) {
        const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
        X.font = fnt('b', 400, size);
        lines.forEach((line, index) => {
            put(line, right, bottomY - (lines.length - 1 - index) * size * 1.5, X.font, 0, 'r', color);
        });
    }

    // How tall the text block will be at the requested sizes. The band is
    // drawn around the words, not a fixed slab with a hole in it — that is
    // what makes the card look designed rather than templated.
    function stackHeight(items, width) {
        let total = 0;
        items.forEach((item, index) => {
            const size = (item.z || 40) * U;
            const font = fnt(item.f || 'd', item.w, size);
            let value = item.k ? T(item.k) : '';
            if (item.up) value = value.toUpperCase();
            if (!String(value).trim()) return;
            const lines = wrap(value, font, (item.ls || 0) * size, width);
            total += (index ? (item.g || 0) * U : 0) + lines.length * size * (item.lh || 1.15);
        });
        return total;
    }

    const CFG = {
        id: 'postidea',
        title: 'Post Ideas',
        sub: 'Pick a dish from the menu: the post, the caption and the motion come with it.',
        idea: true,
        ideaFormat: 'feed',
        sizes: [
            { n: 'Portrait 4:5', d: 'Feed · 1080×1350', w: 1080, h: 1350, print: false },
            { n: 'Square', d: 'Feed · 1080×1080', w: 1080, h: 1080, print: false },
            { n: 'Story 9:16', d: 'Reels & stories · 1080×1920', w: 1080, h: 1920, print: false },
        ],
        fields: [
            ['eyebrow', 'Badge over the photo'],
            ['hook', 'Hook line'],
            ['kicker', 'Kicker'],
            ['title', 'Dish', 2],
            ['body', 'Description', 3],
            ['price', 'Price'],
            ['foot', 'Handle and location'],
        ],
        tpls: [{
            n: 'Feed post',
            animate: { eyebrow: 0.1, title: 0.25, body: 0.7, price: 1.0, foot: 1.25 },
            sizes: ['Portrait 4:5', 'Square'],
            t: {
                eyebrow: 'MORNING SPECIAL',
                hook: 'Somebody is coming back for this.',
                kicker: 'Brunch, all day',
                title: 'Homemade Brioche French Toast',
                body: 'Blueberry compote & mascarpone, or bacon & maple.',
                price: 'from £14.50',
                foot: '@singlendcafe_glasgow\nGarnethill & Merchant City',
            },
            draw(W, H) {
                const { dark, light } = bandColours();
                const pad = W * 0.062;
                const textWidth = W - 2 * pad;
                const block = [
                    { k: 'kicker', z: 21, f: 'l', up: 1, ls: .18, c: 'accent', g: 0 },
                    { k: 'title', z: 54, lh: 1.06, g: 18, c: light },
                    { k: 'body', z: 24, f: 'b', lh: 1.38, g: 22, c: light },
                ];
                const rowH = 92 * U;
                const textH = stackHeight(block, textWidth);
                const bandH = Math.min(H * 0.52, Math.max(H * 0.3, textH + rowH + H * 0.09));
                const bandTop = H - bandH;

                photo(0, 0, W, bandTop + 2);
                badge(T('eyebrow').toUpperCase(), pad, H * 0.05, 20 * U, dark, light);
                X.fillStyle = dark;
                X.fillRect(0, bandTop, W, bandH);

                stack([pad, bandTop + H * 0.045, textWidth, textH + 4], block, { al: 'l', va: 't' });

                const rowY = H - H * 0.055 - rowH / 2;
                pill(T('price'), pad, rowY, 24 * U, C('accent'), accentTextColor(), fnt('d', 700, 24 * U));
                credits(T('foot'), W - pad, rowY + 9 * U, 17 * U, light);
            },
        }, {
            n: 'Reel cover',
            animate: { eyebrow: 0.2, hook: 0.5, kicker: 1.1, title: 1.4, body: 1.9, price: 2.4, foot: 2.7 },
            sizes: ['Story 9:16'],
            t: {
                eyebrow: 'BREAKFAST RUN',
                hook: 'Somebody is cycling over for this…',
                kicker: 'Brunch, all day',
                title: 'Homemade Brioche French Toast',
                body: 'Blueberry compote & mascarpone, or bacon & maple.',
                price: 'from £14.50',
                foot: '@singlendcafe_glasgow\nOpen every day',
            },
            draw(W, H) {
                const { dark, light } = bandColours();
                const pad = W * 0.07;
                photo(0, 0, W, H);
                grad(0, 0, W, H * 0.44, dark, .84, 0);
                grad(0, H * 0.42, W, H * 0.58, dark, 0, .95);

                // Instagram's chrome covers roughly the top 13% and the
                // bottom 14%: everything worth reading stays inside.
                stack([pad, H * 0.115, W - 2 * pad, H * 0.22], [
                    { k: 'eyebrow', z: 30, f: 'l', up: 1, ls: .24, c: 'accent', g: 18 },
                    { k: 'hook', z: 68, lh: 1.08, c: light, g: 16 },
                ], { al: 'l', va: 't' });

                stack([pad, H * 0.54, W - 2 * pad, H * 0.26], [
                    { k: 'kicker', z: 26, f: 'l', up: 1, ls: .2, c: 'accent', g: 16 },
                    { k: 'title', z: 82, lh: 1.03, c: light, g: 18 },
                    { k: 'body', z: 29, f: 'b', lh: 1.35, c: light, g: 16 },
                ], { al: 'l', va: 'b' });

                const rowY = H * 0.885;
                pill(T('price'), pad, rowY, 27 * U, C('accent'), accentTextColor(), fnt('d', 700, 27 * U));
                credits(T('foot'), W - pad, rowY + 11 * U, 21 * U, light);
            },
        }],
    };
    window.AssetCategories['postidea'] = CFG;
})();

/* =====================================================================
 * Reel ideas — the same dish, twelve ways to open a nine-by-sixteen.
 * Each design is the poster frame of a ten-second loop; the animation is
 * written down in the caption's motion line rather than faked in a still.
 *
 * The engine calls draw(width, height) at the *target* pixel size, so every
 * fixed size here is multiplied by `U` (width / 1080). Stack sizes (`z`) are
 * already in 1080 units and are scaled by the engine.
 * ===================================================================== */
(function () {
    const padOf = W => W * 0.075;

    function tones() {
        const ink = C('ink');
        const paper = C('paper');
        return colorLuma(ink) <= colorLuma(paper)
            ? { dark: ink, light: paper }
            : { dark: paper, light: ink };
    }

    // A pill, left-aligned at x (or centred when align is 'c').
    function pill(text, x, centreY, size, bg, fg, font, align) {
        const value = String(text || '').trim();
        if (!value) return 0;
        const face = font || fnt('d', 700, size);
        X.font = face;
        const height = size * 2.1;
        const width = tw(value, face, 0) + size * 2.2;
        const left = align === 'c' ? x - width / 2 : x;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(left, centreY - height / 2, width, height, height / 2);
        X.fill();
        put(value, left + size * 1.1, centreY + 1, face, 0, 'l', fg);
        return width;
    }

    function chip(text, x, y, size, bg, fg) {
        const value = String(text || '').trim();
        if (!value) return 0;
        X.font = fnt('l', 700, size);
        const height = size * 2.2;
        const width = tw(value, X.font, size * 0.08) + size * 2.4;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(x, y, width, height, size * 0.35);
        X.fill();
        put(value, x + size * 1.2, y + height / 2 + 1, X.font, size * 0.08, 'l', fg);
        return width;
    }

    function rule(x, y, width, thickness, color) {
        X.fillStyle = color;
        X.fillRect(x, y, width, thickness);
    }

    function dashed(x, y, width, color, thickness) {
        X.save();
        X.strokeStyle = color;
        X.lineWidth = thickness || 2 * U;
        X.setLineDash([10 * U, 8 * U]);
        X.beginPath();
        X.moveTo(x, y);
        X.lineTo(x + width, y);
        X.stroke();
        X.restore();
    }

    // One repeating strip, drawn edge to edge.
    function ticker(text, y, height, bg, fg, size) {
        const value = String(text || '').trim();
        if (!value || !height) return;
        X.fillStyle = bg;
        X.fillRect(0, y, W_TARGET, height);
        X.font = fnt('l', 700, size);
        const unit = value + '  ·  ';
        const step = tw(unit, X.font, 0) || 1;
        let x = 0;
        X.fillStyle = fg;
        while (x < W_TARGET) {
            put(unit, x, y + height / 2 + 1, X.font, 0, 'l', fg);
            x += step;
        }
    }

    let W_TARGET = 1080;

    // Sixteen-point burst used for a price sticker.
    function burst(cx, cy, radius, text, bg, fg, size) {
        const points = 16;
        X.save();
        X.beginPath();
        for (let i = 0; i < points * 2; i += 1) {
            const angle = (Math.PI * i) / points - Math.PI / 2;
            const r = i % 2 ? radius * 0.82 : radius;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (i === 0) X.moveTo(px, py); else X.lineTo(px, py);
        }
        X.closePath();
        X.fillStyle = bg;
        X.fill();
        X.restore();
        X.font = fnt('l', 700, size);
        put(String(text || ''), cx, cy + 2, X.font, 0, 'c', fg);
    }

    function lines(text, limit) {
        return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, limit || 4);
    }

    // One line, trimmed to a width with an ellipsis: a lower-third bar cannot
    // grow, so the copy has to fit it.
    function fitLine(text, font, maxWidth, tracking) {
        const value = String(text || '').trim();
        const track = tracking || 0;
        X.font = font;
        if (tw(value, font, track) <= maxWidth) return value;
        let cut = value;
        while (cut.length > 4 && tw(cut + '…', font, track) > maxWidth) cut = cut.slice(0, -1);
        return cut.trimEnd() + '…';
    }

    // A handle and a place arrive as two lines for the feed cards; a reel
    // prints them on one marquee, so join them.
    function footText() {
        return String(T('foot') || '').replace(/\s*\n+\s*/g, ' · ').trim();
    }

    // Right-aligned handle/location, one line per newline.
    function creditsText(text, right, bottomY, size, color) {
        const list = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
        X.font = fnt('b', 400, size);
        list.forEach((line, index) => {
            put(line, right, bottomY - (list.length - 1 - index) * size * 1.5, X.font, 0, 'r', color);
        });
    }

    // A dish card used by several layouts.
    function dishCard(x, y, width, height, tonesIn, u) {
        const { dark, light } = tonesIn;
        X.fillStyle = dark;
        X.beginPath();
        X.roundRect(x, y, width, height, 26 * u);
        X.fill();
        stack([x + 34 * u, y + height * 0.13, width - 68 * u, height * 0.5], [
            { k: 'title', z: 50, lh: 1.05, c: light, g: 14 },
            { k: 'body', z: 24, f: 'l', lh: 1.35, c: light, g: 22 },
        ], { al: 'l', va: 't' });
        pill(T('price'), x + 34 * u, y + height - height * 0.16, 26 * u, C('accent'), accentTextColor(), fnt('d', 700, 26 * u));
        X.font = fnt('l', 500, 20 * u);
        put(String(T('foot') || ''), x + width - 34 * u, y + height - height * 0.16, X.font, 0, 'r', light);
    }

    const CFG = {
        id: 'reelidea',
        title: 'Reel Ideas',
        sub: 'The poster frame of a ten-second loop: pick a dish, then record it.',
        idea: true,
        ideaFormat: 'reel',
        sizes: [
            { n: 'Story 9:16', d: 'Reels & stories · 1080×1920', w: 1080, h: 1920, print: false },
        ],
        fields: [
            ['eyebrow', 'Badge / small label'],
            ['hook', 'Hook line'],
            ['kicker', 'Kicker / location'],
            ['title', 'Dish', 2],
            ['body', 'Description', 3],
            ['price', 'Price'],
            ['foot', 'Handle'],
        ],
        tpls: [{
            /* 1 · Whisper — one line, one price, a lot of air. */
            n: 'Whisper',
            animate: { title: 1.1, body: 2.1, price: 3.1, foot: 3.7 },
            motion: '0–2s the street pans slowly · 2–4s a hairline draws under the title · 4–7s the title and detail settle in · 7–9s the price',
            t: {
                title: 'Eggs on toast',
                body: 'POACHED OR FRIED · TOASTED SOURDOUGH',
                price: '£7.50',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const { dark, light } = tones();
                const pad = padOf(W);
                photo(0, 0, W, H);
                grad(0, H * 0.38, W, H * 0.62, dark, 0, .94);
                rule(pad, H * 0.6, W * 0.12, 3 * u, light);
                stack([pad, H * 0.615, W - 2 * pad, H * 0.13], [
                    { k: 'title', z: 96, lh: 1.02, c: light },
                ], { al: 'l', va: 't' });
                stack([pad, H * 0.75, W - 2 * pad, H * 0.11], [
                    { k: 'body', z: 30, f: 'l', up: 1, ls: .14, c: light, g: 8 },
                    { k: 'price', z: 38, f: 'l', ls: .1, c: 'accent', g: 22 },
                ], { al: 'l', va: 't' });
                creditsText(footText(), W - pad, H * 0.87, 22 * u, light);
            },
        }, {
            /* 2 · Arch window — the building's doorway as the frame. */
            n: 'Arch window',
            animate: { title: 0.9, body: 1.5, price: 2.3, foot: 2.7 },
            motion: '0–2s the arch opens from the bottom · 2–4s the photograph drifts inside it · 4–6s the title rises · 6–8s detail, rule and price',
            t: {
                title: 'Home Baked Granola',
                body: 'Greek yoghurt, maple syrup & seasonal fruit',
                price: '£7.50',
                foot: 'Singl-end Cafe & Bakehouse',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink');
                X.fillStyle = C('paper');
                X.fillRect(0, 0, W, H);
                const archW = W * 0.6, archX = (W - archW) / 2, archY = H * 0.14, archH = H * 0.46;
                const reveal = easeOut(phase(0.4, 1.6));
                X.save();
                X.beginPath();
                X.moveTo(archX, archY + archH);
                X.lineTo(archX, archY + archW / 2);
                X.arc(archX + archW / 2, archY + archW / 2, archW / 2, Math.PI, 0);
                X.lineTo(archX + archW, archY + archH);
                X.closePath();
                X.clip();
                X.beginPath();
                X.rect(archX, archY + archH * (1 - reveal), archW, archH * reveal);
                X.clip();
                photo(archX, archY, archW, archH);
                X.restore();
                stack([0, H * 0.655, W, H * 0.15], [{ k: 'title', z: 86, lh: 1.02, c: ink }], { al: 'c', va: 't' });
                rule(W * 0.46, H * 0.76, W * 0.08, 2 * u, C('accent'));
                stack([W * 0.12, H * 0.78, W * 0.76, H * 0.08], [
                    { k: 'body', z: 27, f: 'l', lh: 1.45, c: mix(ink, C('paper'), .1) },
                ], { al: 'c', va: 't' });
                stack([0, H * 0.855, W, H * 0.06], [
                    { k: 'price', z: 34, f: 'l', ls: .22, up: 1, c: ink },
                    { k: 'foot', z: 19, f: 'l', ls: .16, up: 1, c: mix(ink, C('paper'), .4), g: 18 },
                ], { al: 'c', va: 't' });
            },
        }, {
            /* 3 · Widening band — a thin line opens into the street. */
            n: 'Widening band',
            animate: { title: 1.2, price: 2.0, foot: 2.6 },
            motion: '0–2s a hairline opens into a band across the frame · 2–5s the photograph drifts inside it · 5–7s the title, 7–9s price and marque',
            t: {
                title: 'Flat White',
                price: '£4.00',
                foot: 'Singl-end Cafe & Bakehouse',
            },
            draw(W, H) {
                W_TARGET = W;
                const { dark, light } = tones();
                X.fillStyle = dark;
                X.fillRect(0, 0, W, H);
                const grow = easeOut(phase(0.5, 1.8));
                const bandY = H * 0.3, bandH = Math.max(6 * U, H * 0.34 * grow);
                photo(0, bandY, W, bandH);
                stack([0, bandY + bandH + H * 0.08, W, H * 0.1], [
                    { k: 'title', z: 64, f: 'l', up: 1, ls: .12, c: light },
                ], { al: 'c', va: 't' });
                stack([0, bandY + bandH + H * 0.2, W, H * 0.06], [
                    { k: 'price', z: 44, f: 'l', ls: .2, c: 'accent' },
                ], { al: 'c', va: 't' });
                stack([0, bandY + bandH + H * 0.29, W, H * 0.05], [
                    { k: 'foot', z: 20, f: 'l', up: 1, ls: .3, c: light },
                ], { al: 'c', va: 't' });
            },
        }, {
            /* 4 · Order ticket — the receipt is the poster. */
            n: 'Order ticket',
            animate: { hook: 0.2, kicker: 0.9, title: 1.3, body: 1.9, price: 2.5, foot: 2.9 },
            motion: '0–2s the scene dims · 2–4s the receipt prints down the frame · 4–6s the lines type on · 6–8s the stamp lands',
            t: {
                eyebrow: 'SERVED ALL DAY',
                hook: 'Table for one on John Street?',
                kicker: 'Singl-end · Merchant City',
                title: 'Mediterranean Sunrise Toast',
                body: 'Whipped feta, roasted red peppers, crispy parma ham, poached eggs, thyme hot honey, sourdough',
                price: '£15.00',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const cream = C('paper'), ink = C('ink');
                const pad = padOf(W);
                photo(0, 0, W, H);
                X.fillStyle = rgba(C('ink'), .58);
                X.fillRect(0, 0, W, H);
                grad(0, 0, W, H * 0.3, C('ink'), .78, 0);
                stack([pad, H * 0.1, W - 2 * pad, H * 0.16], [
                    { k: 'hook', z: 64, lh: 1.05, c: cream },
                ], { al: 'l', va: 't' });

                const tx = pad, ty = H * 0.34, cardW = W - 2 * pad, th = H * 0.32;
                X.fillStyle = cream;
                X.fillRect(tx, ty, cardW, th);
                X.beginPath();
                for (let i = 0; i < Math.floor(cardW / (26 * u)); i += 1) {
                    X.moveTo(tx + i * 26 * u, ty + th + 9 * u);
                    X.arc(tx + i * 26 * u, ty + th, 13 * u, Math.PI, 0, true);
                }
                X.fillStyle = cream;
                X.fill();

                X.font = fnt('l', 700, 22 * u);
                put(String(T('kicker') || '').toUpperCase(), tx + 26 * u, ty + 40 * u, X.font, 1.6 * u, 'l', mix(ink, cream, .25));
                dashed(tx + 26 * u, ty + 62 * u, cardW - 52 * u, rgba(ink, .3), 2 * u);
                stack([tx + 26 * u, ty + 82 * u, cardW - 52 * u, H * 0.055], [
                    { k: 'title', z: 40, lh: 1.1, c: ink },
                ], { al: 'l', va: 't' });
                stack([tx + 26 * u, ty + 158 * u, cardW - 52 * u, H * 0.1], [
                    { k: 'body', z: 24, f: 'l', lh: 1.4, c: mix(ink, cream, .18) },
                ], { al: 'l', va: 't' });
                const totalY = ty + th - 70 * u;
                dashed(tx + 26 * u, totalY - 26 * u, cardW - 52 * u, rgba(ink, .3), 2 * u);
                X.font = fnt('l', 700, 28 * u);
                put('TOTAL', tx + 26 * u, totalY + 12 * u, X.font, 2 * u, 'l', ink);
                X.font = fnt('d', 700, 34 * u);
                put(String(T('price') || ''), tx + cardW - 26 * u, totalY + 12 * u, X.font, 0, 'r', ink);
                X.font = fnt('l', 500, 20 * u);
                put(String(footText() || ''), tx + 26 * u, totalY + 46 * u, X.font, .6 * u, 'l', mix(ink, cream, .35));

                const stamp = String(T('eyebrow') || '').toUpperCase();
                if (stamp) {
                    X.save();
                    X.translate(W * 0.6, H * 0.72);
                    X.rotate(-0.2);
                    X.font = fnt('l', 700, 32 * u);
                    const sw = tw(stamp, X.font, 3 * u) + 52 * u, sh = 70 * u;
                    X.fillStyle = rgba(cream, .92);
                    X.fillRect(-sw / 2, -sh / 2, sw, sh);
                    X.strokeStyle = '#b4283c';
                    X.lineWidth = 6 * u;
                    X.strokeRect(-sw / 2 + 8 * u, -sh / 2 + 8 * u, sw - 16 * u, sh - 16 * u);
                    put(stamp, 0, 2 * u, X.font, 3 * u, 'c', '#b4283c');
                    X.restore();
                }
            },
        }, {
            /* 5 · Polaroid scrapbook — stuck to the wall, not designed. */
            n: 'Polaroid',
            animate: { hook: 0.3, title: 1.3, price: 2.1, body: 2.5, foot: 3.0 },
            motion: '0–2s the hook writes itself on · 2–4s the polaroid drops and settles · 4–6s the photo sharpens and the price sticker pops · 6–8s the note',
            t: {
                hook: 'Rough night? Sorted.',
                title: 'Cure yer Heid',
                body: 'strawberries, raspberries, blueberries, banana, ginger & orange juice',
                price: '£6.50',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink'), accent = C('accent');
                X.fillStyle = accent;
                X.fillRect(0, 0, W, H);
                X.fillStyle = rgba(ink, .08);
                for (let y = 30 * u; y < H; y += 54 * u) {
                    for (let x = 30 * u; x < W; x += 54 * u) X.fillRect(x, y, 6 * u, 6 * u);
                }
                stack([W * 0.08, H * 0.08, W * 0.84, H * 0.12], [
                    { k: 'hook', z: 66, lh: 1, c: ink },
                ], { al: 'l', va: 't' });

                const cardW = W * 0.76, cardX = W * 0.12, cardY = H * 0.26;
                const photoH = cardW * (976 / 1098);
                X.save();
                X.translate(cardX + cardW / 2, cardY + (photoH + 110 * u) / 2);
                X.rotate(-0.06);
                X.translate(-(cardX + cardW / 2), -(cardY + (photoH + 110 * u) / 2));
                X.fillStyle = '#ffffff';
                X.fillRect(cardX, cardY, cardW, photoH + 130 * u);
                X.fillStyle = 'rgba(242,226,160,.85)';
                X.fillRect(cardX + cardW * 0.34, cardY - 20 * u, cardW * 0.32, 42 * u);
                photo(cardX + 16 * u, cardY + 16 * u, cardW - 32 * u, photoH - 16 * u);
                X.font = fnt('d', 600, 42 * u);
                put(String(T('title') || ''), cardX + cardW / 2, cardY + photoH + 52 * u, X.font, 0, 'c', ink);
                X.restore();

                const stickerX = W * 0.7, stickerY = H * 0.68;
                X.beginPath();
                X.arc(stickerX, stickerY, W * 0.125, 0, Math.PI * 2);
                X.fillStyle = C('ink');
                X.fill();
                X.font = fnt('l', 700, 42 * u);
                put(String(T('price') || ''), stickerX, stickerY + 2 * u, X.font, 0, 'c', C('paper'));

                stack([W * 0.1, H * 0.76, W * 0.62, H * 0.12], [
                    { k: 'body', z: 30, f: 'd', lh: 1.2, c: ink },
                    { k: 'foot', z: 20, f: 'l', ls: .12, c: mix(ink, accent, .4), g: 14 },
                ], { al: 'l', va: 't' });
            },
        }, {
            /* 6 · Kinetic type — words first, one round crop, a price burst. */
            n: 'Kinetic type',
            animate: { eyebrow: 0.2, title: 0.5, body: 3.3, price: 4.5, foot: 1.0 },
            motion: '0–2s THE slams, then the dish name · 2–4s the round crop pops · 4–6s the ingredient chips · 6–8s the price burst · marquee runs throughout',
            t: {
                eyebrow: 'THE',
                title: 'Betty',
                body: 'Halloumi, Avocado & chilli smash, Poached eggs, Sriracha',
                price: '£14.50',
                foot: 'Singl-end Cafe & Bakehouse · Open everyday',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink'), accent = C('accent');
                X.fillStyle = accent;
                X.fillRect(0, 0, W, H);
                stack([W * 0.07, H * 0.07, W * 0.86, H * 0.05], [
                    { k: 'eyebrow', z: 40, f: 'l', up: 1, ls: .18, c: ink },
                ], { al: 'l', va: 't' });
                stack([W * 0.07, H * 0.115, W * 0.86, H * 0.16], [
                    { k: 'title', z: 118, f: 'l', up: 1, lh: 1, c: ink },
                ], { al: 'l', va: 't' });

                const cx = W * 0.5, cy = H * 0.45, r = W * 0.3;
                X.save();
                X.beginPath();
                X.arc(cx, cy, r, 0, Math.PI * 2);
                X.clip();
                photo(cx - r, cy - r, r * 2, r * 2);
                X.restore();
                X.strokeStyle = ink;
                X.lineWidth = 16 * u;
                X.beginPath();
                X.arc(cx, cy, r, 0, Math.PI * 2);
                X.stroke();

                burst(W * 0.76, H * 0.565, W * 0.13, T('price'), ink, accent, 34 * u);

                const tags = String(T('body') || '').split(/,\s*/).filter(Boolean).slice(0, 4);
                const tagSize = 24 * u;
                X.font = fnt('l', 700, tagSize);
                const widths = tags.map(tag => tw(tag, X.font, 0) + tagSize * 2.4);
                const rowWidth = widths.reduce((sum, width) => sum + width, 0) + 10 * u * (tags.length - 1);
                let x = (W - rowWidth) / 2;
                tags.forEach((tag, index) => {
                    chip(tag, x, H * 0.655, tagSize, ink, C('paper'));
                    x += widths[index] + 10 * u;
                });
                ticker(String(footText() || '').toUpperCase(), H * 0.925, H * 0.05, ink, accent, 22 * u);
            },
        }, {
            /* 7 · Bike wipe — grey on the left, dinner on the right. */
            n: 'Bike wipe',
            animate: { title: 6.6, body: 6.9, price: 7.2, foot: 7.2 },
            motion: '0–2s grey street, HUNGRY · 2–5s the wipe rides left to right and colour returns · 5–7s HAPPY · 7–9s the dish card',
            t: {
                title: 'The Meaty',
                body: 'Poached eggs, potato scone, streaky bacon, lorne sausage, haggis, black pudding & more.',
                price: '£15.25',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const { dark, light } = tones();
                const split = W * easeInOut(phase(3, 3.5));
                X.save();
                X.beginPath();
                X.rect(0, 0, split, H);
                X.clip();
                X.filter = 'grayscale(1) brightness(.62)';
                photo(0, 0, W, H);
                X.filter = 'none';
                X.restore();
                X.save();
                X.beginPath();
                X.rect(split, 0, W - split, H);
                X.clip();
                photo(0, 0, W, H);
                X.restore();
                X.fillStyle = '#ffffff';
                X.fillRect(split - 3 * u, 0, 6 * u, H);

                chip('BEFORE', W * 0.06, H * 0.075, 20 * u, dark, light);
                chip('AFTER', split + W * 0.04, H * 0.075, 20 * u, C('accent'), accentTextColor());
                dishCard(W * 0.06, H * 0.62, W * 0.88, H * 0.22, { dark, light }, u);
            },
        }, {
            /* 8 · Hunger gauge — the bar drains, the colours come back. */
            n: 'Hunger gauge',
            animate: { title: 6.2, body: 6.5, price: 6.9, foot: 6.9 },
            motion: '0–2s HUNGRY, the gauge full · 2–6s the bar drains and colour returns · 6–8s the dish card rises',
            t: {
                title: 'Le Croque Gary',
                body: 'Stornoway black pudding, caramelised onions, dijon mustard, béchamel & grilled emmental.',
                price: '£15.00',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const { dark, light } = tones();
                const pad = padOf(W);
                photo(0, 0, W, H);
                X.fillStyle = rgba(C('ink'), .45);
                X.fillRect(0, 0, W, H);
                X.font = fnt('l', 700, 22 * u);
                put('HUNGER LEVEL', pad, H * 0.095, X.font, 2.4 * u, 'l', light);
                const gaugeY = H * 0.12, gaugeW = W * 0.5, gaugeH = 22 * u;
                X.fillStyle = rgba(light, .25);
                X.beginPath();
                X.roundRect(pad, gaugeY, gaugeW, gaugeH, gaugeH / 2);
                X.fill();
                X.fillStyle = C('accent');
                X.beginPath();
                X.roundRect(pad, gaugeY, gaugeW * 0.34, gaugeH, gaugeH / 2);
                X.fill();
                dashed(pad, H * 0.18, W - 2 * pad, rgba(light, .6), 2 * u);
                dishCard(pad, H * 0.6, W - 2 * pad, H * 0.24, { dark, light }, u);
            },
        }, {
            /* 9 · Flip card — hangry on one side, dinner on the other. */
            n: 'Flip card',
            animate: { eyebrow: 0.6, title: 1.2, body: 1.8, price: 2.4 },
            motion: '0–3s HANGRY?, card shakes · 3–5s the card flips · 5–8s HAPPY. with the dish and price',
            t: {
                eyebrow: 'HAPPY.',
                title: 'Royale',
                body: 'Flaked smoked salmon, poached eggs, hollandaise, toasted sourdough',
                price: '£15.00',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink'), paper = C('paper');
                X.save();
                X.filter = 'blur(6px) brightness(.5)';
                photo(-W * 0.1, -H * 0.05, W * 1.2, H * 1.1);
                X.filter = 'none';
                X.restore();

                const cardW = W * 0.76, cardX = (W - cardW) / 2, cardY = H * 0.22, cardH = H * 0.52;
                X.fillStyle = C('accent');
                X.beginPath();
                X.roundRect(cardX, cardY, cardW, cardH, 34 * u);
                X.fill();
                stack([cardX + 44 * u, cardY + H * 0.09, cardW - 88 * u, H * 0.07], [
                    { k: 'eyebrow', z: 72, f: 'l', up: 1, ls: .04, c: ink },
                ], { al: 'c', va: 't' });
                stack([cardX + 44 * u, cardY + H * 0.19, cardW - 88 * u, H * 0.12], [
                    { k: 'title', z: 56, lh: 1.05, c: ink },
                ], { al: 'c', va: 't' });
                stack([cardX + 54 * u, cardY + H * 0.33, cardW - 108 * u, H * 0.12], [
                    { k: 'body', z: 26, f: 'l', lh: 1.4, c: ink },
                ], { al: 'c', va: 't' });
                pill(T('price'), W / 2, cardY + cardH - H * 0.06, 30 * u, ink, paper, fnt('l', 700, 30 * u), 'c');
            },
        }, {
            /* 10 · Breaking news — the lower third does the work. */
            n: 'Breaking news',
            animate: { kicker: 0.3, title: 2.4, body: 3.5, price: 3.5, foot: 2.4 },
            motion: '0–.3s white flash · .3–2s BREAKING slams · 2–6s lower third slides in, headline then detail · ticker runs throughout',
            t: {
                eyebrow: 'BREAKING',
                kicker: 'Singl-end News · REC',
                title: 'Cyclist diverts route for breakfast',
                body: 'Haggis, chilli jam & poached eggs “worth the detour”',
                price: '£14.75',
                foot: 'Singl-end Cafe & Bakehouse · Open everyday',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink'), paper = C('paper'), accent = C('accent');
                photo(0, 0, W, H);
                X.fillStyle = 'rgba(0,0,0,.16)';
                for (let y = 0; y < H; y += 6 * u) X.fillRect(0, y, W, 2 * u);
                grad(0, 0, W, H, ink, .55, .15);
                chip('LIVE', W * 0.05, H * 0.07, 24 * u, '#d6202f', '#ffffff');
                X.font = fnt('l', 700, 22 * u);
                put(String(T('kicker') || '').toUpperCase(), W - W * 0.05, H * 0.09, X.font, 1.4 * u, 'r', paper);

                const tag = String(T('eyebrow') || 'BREAKING').toUpperCase();
                X.font = fnt('l', 700, 22 * u);
                const tagW = tw(tag, X.font, 2.6 * u) + 38 * u, tagH = 52 * u;
                const thirdY = H * 0.6;
                X.fillStyle = '#d6202f';
                X.fillRect(W * 0.05, thirdY, tagW, tagH);
                put(tag, W * 0.05 + 19 * u, thirdY + tagH / 2 + 1, X.font, 2.6 * u, 'l', '#ffffff');
                const headY = thirdY + tagH, headH = H * 0.13;
                X.fillStyle = ink;
                X.fillRect(W * 0.05, headY, W * 0.95, headH);
                stack([W * 0.05 + 26 * u, headY + 20 * u, W * 0.95 - 52 * u, headH - 30 * u], [
                    { k: 'title', z: 44, f: 'l', up: 1, lh: 1.06, c: paper },
                ], { al: 'l', va: 't' });
                const subY = headY + headH, subH = 54 * u;
                X.fillStyle = paper;
                X.fillRect(W * 0.05, subY, W * 0.95, subH);
                X.font = fnt('l', 700, 22 * u);
                const subLine = fitLine([T('body'), T('price')].filter(Boolean).join('  ·  ').toUpperCase(), X.font, W * 0.95 - 40 * u, 1.2 * u);
                put(subLine, W * 0.05 + 20 * u, subY + subH / 2 + 1, X.font, 1.2 * u, 'l', ink);
                ticker(String(footText() || '').toUpperCase(), H * 0.9, H * 0.045, ink, accent, 20 * u);
            },
        }, {
            /* 11 · Live report — a field checklist over the street. */
            n: 'Live report',
            animate: { price: 1.0, title: 2.0, body: 3.0, foot: 3.4, eyebrow: 0.3, kicker: 0.3 },
            motion: '0–2s LIVE and the location · 2–4s the price stamp · 4–7s the panel, one line at a time · ticker throughout',
            t: {
                eyebrow: 'LIVE',
                kicker: 'John Street · Merchant City',
                title: 'The Clubbin Chicken Sandwich',
                body: 'Grilled chicken breast, Crispy bacon, Hot honey halloumi, Roasted garlic & truffle mayo, Sriracha hot sauce slaw',
                price: '£15.50',
                foot: 'Open everyday · @singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const { dark, light } = tones();
                const accent = C('accent');
                photo(0, 0, W, H);
                X.fillStyle = 'rgba(0,0,0,.14)';
                for (let y = 0; y < H; y += 6 * u) X.fillRect(0, y, W, 2 * u);
                grad(0, 0, W, H, C('ink'), .5, .2);
                chip(String(T('eyebrow') || 'LIVE').toUpperCase(), W * 0.05, H * 0.07, 24 * u, '#d6202f', '#ffffff');
                X.font = fnt('l', 700, 20 * u);
                const place = lines(T('kicker'), 2);
                place.forEach((line, index) => put(line.toUpperCase(), W - W * 0.05, H * 0.085 + index * 28 * u, X.font, 1.4 * u, 'r', light));

                if (T('price')) {
                    X.save();
                    X.translate(W * 0.74, H * 0.235);
                    X.rotate(0.07);
                    X.font = fnt('l', 700, 52 * u);
                    const width = tw(String(T('price')), X.font, 0) + 40 * u;
                    X.fillStyle = '#d6202f';
                    X.fillRect(-width / 2, -42 * u, width, 84 * u);
                    put(String(T('price')), 0, 2 * u, X.font, 0, 'c', '#ffffff');
                    X.restore();
                }

                const panelX = W * 0.06, panelW = W * 0.88, panelY = H * 0.33, panelH = H * 0.28;
                X.fillStyle = rgba(dark, .92);
                X.fillRect(panelX, panelY, panelW, panelH);
                X.fillStyle = accent;
                X.fillRect(panelX, panelY, panelW, 10 * u);
                X.font = fnt('l', 700, 19 * u);
                put('ON THE MENU TODAY', panelX + 30 * u, panelY + 42 * u, X.font, 2.2 * u, 'l', accent);
                stack([panelX + 30 * u, panelY + 60 * u, panelW - 60 * u, H * 0.085], [
                    { k: 'title', z: 44, f: 'l', up: 1, lh: 1.02, c: light },
                ], { al: 'l', va: 't' });
                const list = String(T('body') || '').split(/,\s*/).filter(Boolean).slice(0, 5);
                const startY = panelY + H * 0.155;
                list.forEach((item, index) => {
                    X.font = fnt('l', 700, 22 * u);
                    put('✓', panelX + 30 * u, startY + index * 32 * u, X.font, 0, 'l', accent);
                    put(item, panelX + 62 * u, startY + index * 32 * u, X.font, 0, 'l', light);
                });

                X.font = fnt('l', 700, 20 * u);
                put(String(footText() || '').toUpperCase(), panelX, H * 0.67, X.font, 1.4 * u, 'l', light);
                ticker(String(footText() || '').toUpperCase(), H * 0.9, H * 0.045, dark, accent, 20 * u);
            },
        }, {
            /* 12 · Front page extra — the dish is the story. */
            n: 'Front page extra',
            animate: { kicker: 0.6, title: 1.4, body: 2.6, price: 3.4, foot: 3.6 },
            motion: '0–2s the page spins in · 2–4s the headline · 4–6s the photo box wipes in · 6–8s the caption, EXTRA! stamp',
            t: {
                kicker: 'Glasgow · Daily · Price: one smile',
                title: 'Dirty Chai takes Glasgow by storm',
                body: 'Terrace regulars, John Street, Merchant City.',
                price: '£5.35',
                foot: 'Sit in or take away · @singlendcafe_glasgow',
            },
            draw(W, H) {
                W_TARGET = W;
                const u = U;
                const ink = C('ink');
                const paper = mix(C('paper'), '#efe7d4', .4);
                X.fillStyle = paper;
                X.fillRect(0, 0, W, H);
                const pad = W * 0.06;
                X.font = fnt('d', 800, 44 * u);
                put(String((S && (S.brandWordmark || S.brandName)) || 'The Singl-End Gazette').toUpperCase(), W / 2, H * 0.07, X.font, 0, 'c', ink);
                rule(pad, H * 0.095, W - 2 * pad, 7 * u, ink);
                X.font = fnt('l', 700, 18 * u);
                put(String(T('kicker') || '').toUpperCase(), W / 2, H * 0.112, X.font, 2.4 * u, 'c', mix(ink, paper, .2));
                stack([pad, H * 0.145, W - 2 * pad, H * 0.14], [
                    { k: 'title', z: 60, lh: 1.02, c: ink },
                ], { al: 'l', va: 't' });

                const photoY = H * 0.32, photoH = H * 0.3;
                X.save();
                X.filter = 'grayscale(1) contrast(1.2)';
                photo(pad, photoY, W - 2 * pad, photoH);
                X.filter = 'none';
                X.restore();
                X.strokeStyle = ink;
                X.lineWidth = 5 * u;
                X.strokeRect(pad, photoY, W - 2 * pad, photoH);

                stack([pad, photoY + photoH + H * 0.02, W - 2 * pad, H * 0.06], [
                    { k: 'body', z: 26, f: 'l', lh: 1.4, c: ink },
                ], { al: 'l', va: 't' });
                stack([pad, photoY + photoH + H * 0.085, W - 2 * pad, H * 0.09], [
                    { k: 'price', z: 44, f: 'd', c: ink },
                    { k: 'foot', z: 21, f: 'l', c: mix(ink, paper, .2), g: 12 },
                ], { al: 'l', va: 't' });

                X.save();
                X.translate(W * 0.76, H * 0.5);
                X.rotate(-0.18);
                X.font = fnt('l', 700, 50 * u);
                const label = 'EXTRA!';
                const width = tw(label, X.font, 3 * u) + 46 * u;
                X.strokeStyle = '#b4283c';
                X.lineWidth = 7 * u;
                X.strokeRect(-width / 2, -42 * u, width, 84 * u);
                put(label, 0, 2 * u, X.font, 3 * u, 'c', '#b4283c');
                X.restore();
            },
        }],
    };
    window.AssetCategories['reelidea'] = CFG;
})();

/* =====================================================================
 * Story reels — collaborations told as a ten-second story.
 * A dish is still the point, but the design carries a narrative: a
 * character, three beats and a punchline. The dish picker only touches the
 * dish fields (`dishFields`), so the story survives a menu change.
 * ===================================================================== */
(function () {
    const padOf = W => W * 0.07;

    function tones() {
        const ink = C('ink');
        const paper = C('paper');
        return colorLuma(ink) <= colorLuma(paper)
            ? { dark: ink, light: paper }
            : { dark: paper, light: ink };
    }

    function pill(text, x, centreY, size, bg, fg, font, align) {
        const value = String(text || '').trim();
        if (!value) return 0;
        const face = font || fnt('d', 700, size);
        X.font = face;
        const height = size * 2.1;
        const width = tw(value, face, 0) + size * 2.2;
        const left = align === 'c' ? x - width / 2 : x;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(left, centreY - height / 2, width, height, height / 2);
        X.fill();
        put(value, left + size * 1.1, centreY + 1, face, 0, 'l', fg);
        return width;
    }

    function chip(text, x, y, size, bg, fg) {
        const value = String(text || '').trim();
        if (!value) return 0;
        X.font = fnt('l', 700, size);
        const height = size * 2.2;
        const width = tw(value, X.font, size * 0.08) + size * 2.4;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(x, y, width, height, size * 0.35);
        X.fill();
        put(value, x + size * 1.2, y + height / 2 + 1, X.font, size * 0.08, 'l', fg);
        return width;
    }

    function rule(x, y, width, thickness, color) {
        X.fillStyle = color;
        X.fillRect(x, y, width, thickness);
    }

    function dashed(x, y, width, color, thickness) {
        X.save();
        X.strokeStyle = color;
        X.lineWidth = thickness || 2 * U;
        X.setLineDash([10 * U, 8 * U]);
        X.beginPath();
        X.moveTo(x, y);
        X.lineTo(x + width, y);
        X.stroke();
        X.restore();
    }

    function footText() {
        return String(T('foot') || '').replace(/\s*\n+\s*/g, ' · ').trim();
    }

    function fitLine(text, font, maxWidth, tracking) {
        const value = String(text || '').trim();
        const track = tracking || 0;
        X.font = font;
        if (tw(value, font, track) <= maxWidth) return value;
        let cut = value;
        while (cut.length > 4 && tw(cut + '…', font, track) > maxWidth) cut = cut.slice(0, -1);
        return cut.trimEnd() + '…';
    }

    // Speech bubble with a tail; used by the puppet theatre and the comic.
    function bubble(text, x, y, width, size, bg, fg, align, tail) {
        const value = String(text || '').trim();
        if (!value) return;
        const face = fnt('l', 800, size);
        const lines = wrap(value, face, 0, width - size * 2.6);
        const lineHeight = size * 1.35;
        const height = lines.length * lineHeight + size * 2.2;
        X.fillStyle = bg;
        X.beginPath();
        X.roundRect(x, y, width, height, size * 0.9);
        X.fill();
        if (tail !== false) {
            X.beginPath();
            X.moveTo(x + width * 0.24, y + height - 1);
            X.lineTo(x + width * 0.2, y + height + size * 1.1);
            X.lineTo(x + width * 0.34, y + height - 1);
            X.closePath();
            X.fill();
        }
        X.font = face;
        lines.forEach((line, index) => {
            put(line, align === 'c' ? x + width / 2 : x + size * 1.3, y + size * 1.1 + index * lineHeight + lineHeight / 2, face, 0, align === 'c' ? 'c' : 'l', fg);
        });
    }

    // Simple eight-bit ghost, drawn instead of relying on an emoji font.
    function ghostSprite(cx, cy, size, color, eye) {
        const unit = size / 8;
        X.fillStyle = color;
        X.beginPath();
        X.moveTo(cx - size / 2, cy + size * 0.42);
        X.lineTo(cx - size / 2, cy - size * 0.1);
        X.arc(cx, cy - size * 0.1, size / 2, Math.PI, 0);
        X.lineTo(cx + size / 2, cy + size * 0.42);
        for (let i = 0; i < 3; i += 1) {
            const x = cx + size / 2 - unit * (i * 2 + 1);
            X.lineTo(x, cy + size * 0.3);
            X.lineTo(x - unit, cy + size * 0.42);
        }
        X.closePath();
        X.fill();
        if (eye) {
            X.fillStyle = eye;
            X.fillRect(cx - size * 0.2, cy - size * 0.14, size * 0.14, size * 0.18);
            X.fillRect(cx + size * 0.06, cy - size * 0.14, size * 0.14, size * 0.18);
        }
    }

    // A marionette: head, body, stick and a nose that can grow.
    function puppet(cx, baseY, height, color, noseColor, noseLength) {
        const head = height * 0.16;
        X.fillStyle = color;
        X.beginPath();
        X.arc(cx, baseY - height + head, head, 0, Math.PI * 2);
        X.fill();
        X.fillRect(cx - head * 0.55, baseY - height + head * 1.9, head * 1.1, height * 0.34);
        X.fillRect(cx - head * 1.35, baseY - height + head * 2.1, head * 2.7, head * 0.5);
        X.fillRect(cx - head * 0.95, baseY - height * 0.48, head * 0.55, height * 0.48);
        X.fillRect(cx + head * 0.4, baseY - height * 0.48, head * 0.55, height * 0.48);
        X.fillRect(cx - head * 0.16, baseY - height * 0.02, head * 0.32, head * 0.4);
        if (noseLength > 0) {
            X.fillStyle = noseColor;
            X.beginPath();
            X.moveTo(cx + head * 0.8, baseY - height + head * 0.9);
            X.lineTo(cx + head * 0.8 + noseLength, baseY - height + head * 0.75);
            X.lineTo(cx + head * 0.8, baseY - height + head * 1.25);
            X.closePath();
            X.fill();
        }
    }

    const CFG = {
        id: 'storyidea',
        title: 'Story Reels',
        sub: 'A dish inside a ten-second story: a character, three beats, a punchline.',
        idea: true,
        ideaFormat: 'reel',
        sizes: [
            { n: 'Story 9:16', d: 'Reels & stories · 1080×1920', w: 1080, h: 1920, print: false },
        ],
        fields: [
            ['eyebrow', 'Small label / chapter'],
            ['partner', 'Character / collaboration'],
            ['line1', 'Story beat 1'],
            ['line2', 'Story beat 2'],
            ['line3', 'Story beat 3'],
            ['title', 'Dish', 2],
            ['body', 'Description', 3],
            ['price', 'Price'],
            ['foot', 'Handle'],
        ],
        tpls: [{
            /* 1 · Night vision — a ghost hunt on the street. */
            n: 'Night vision',
            animate: { eyebrow: 0.1, line1: 1.2, line2: 3.2, line3: 5.1, title: 7.2, body: 7.5, price: 7.8 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s night vision locks on and the cam timecode starts · 2–4s the EMF bars climb and the ghost appears · 4–6s the crew calls it boring · 7–9s the dish card',
            t: {
                eyebrow: 'NIGHT VISION',
                partner: 'Giovannin Senza Paura',
                line1: 'Night one. The haunted castle.',
                line2: 'Ghost detected. BOOOO!',
                line3: 'Giovannin: “…Boring.” Fear level: 0%',
                title: 'Bloody Mary',
                body: 'Vodka, spiced tomato juice, tabasco, black pepper.',
                price: '£9.00',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                const green = '#8dff8d';
                X.save();
                X.filter = 'grayscale(1) sepia(1) hue-rotate(50deg) saturate(4) brightness(.9) contrast(1.35)';
                photo(0, 0, W, H);
                X.filter = 'none';
                X.restore();
                X.fillStyle = 'rgba(0,20,0,.18)';
                for (let y = 0; y < H; y += 7 * u) X.fillRect(0, y, W, 2 * u);
                grad(0, 0, W, H, '#000000', .55, .35);

                X.font = fnt('l', 700, 22 * u);
                X.fillStyle = '#ff3b3b';
                X.fillRect(W * 0.05, H * 0.085, 14 * u, 14 * u);
                put('REC', W * 0.05 + 24 * u, H * 0.088, X.font, 2 * u, 'l', green);
                put(String(T('eyebrow') || 'NIGHT VISION').toUpperCase(), W - W * 0.05, H * 0.088, X.font, 2 * u, 'r', green);
                put('CAM 01 · 02:14:07', W * 0.05, H * 0.135, fnt('l', 500, 20 * u), 1.4 * u, 'l', green);

                // EMF meter
                const emfX = W * 0.86, emfY = H * 0.56;
                for (let i = 0; i < 5; i += 1) {
                    X.fillStyle = i < 3 ? green : 'rgba(141,255,141,.2)';
                    X.fillRect(emfX, emfY - i * 22 * u, 36 * u, 14 * u);
                }
                X.font = fnt('l', 500, 17 * u);
                put('EMF', emfX + 36 * u, emfY + 4 * u, X.font, 1.6 * u, 'r', green);

                ghostSprite(W * 0.5, H * 0.4, W * 0.34, 'rgba(190,255,190,.9)', '#0a1f0a');

                bubble(String(T('line1')), W * 0.08, H * 0.55, W * 0.7, 24 * u, 'rgba(0,0,0,.72)', '#ffffff', 'l');
                X.font = fnt('l', 800, 26 * u);
                put(String(T('line2')).toUpperCase(), W / 2, H * 0.645, X.font, 2 * u, 'c', '#ff9a9a');
                X.font = fnt('l', 600, 22 * u);
                put(fitLine(String(T('line3')), X.font, W * 0.86, 0), W / 2, H * 0.675, X.font, 0, 'c', green);

                const cardY = H * 0.75;
                X.fillStyle = 'rgba(8,24,12,.92)';
                X.fillRect(0, cardY, W, H - cardY);
                stack([W * 0.07, cardY + H * 0.045, W * 0.72, H * 0.16], [
                    { k: 'title', z: 54, lh: 1.05, c: green, g: 14 },
                    { k: 'body', z: 24, f: 'l', lh: 1.35, c: 'rgba(220,255,220,.85)' },
                ], { al: 'l', va: 't' });
                pill(T('price'), W * 0.79, cardY + H * 0.115, 26 * u, green, '#08180a', fnt('l', 700, 26 * u));
            },
        }, {
            /* 2 · Comic strip — four panels and an empty plate. */
            n: 'Comic strip',
            animate: { partner: 0.2, eyebrow: 0.4, line1: 1.0, line2: 2.4, line3: 3.8, title: 5.4, body: 5.7, price: 6.2 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the panels pop in one by one · 2–5s the beats land with a CLACK · 5–7s the empty plate · 7–9s the dish panel',
            t: {
                eyebrow: 'A fearless folk tale',
                partner: 'Giovannin Senza Paura',
                line1: 'Night one. A haunted castle.',
                line2: 'Booo! … “Meh.”',
                line3: 'An EMPTY plate?!',
                title: 'Stornoway',
                body: 'Stornoway black pudding, tomato & chilli jam, poached eggs, hollandaise, toasted sourdough.',
                price: '£14.75',
                foot: 'Fear-free breakfast · @singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                X.fillStyle = '#ffd84a';
                X.fillRect(0, 0, W, H);
                X.fillStyle = 'rgba(232,185,42,.55)';
                for (let y = 18 * u; y < H; y += 30 * u) {
                    for (let x = 18 * u; x < W; x += 30 * u) X.fillRect(x, y, 6 * u, 6 * u);
                }
                X.font = fnt('d', 800, 54 * u);
                const title = fitLine(String(T('partner') || '').toUpperCase(), X.font, W * 0.9, 0);
                X.strokeStyle = '#111111';
                X.lineWidth = 8 * u;
                X.textBaseline = 'middle';
                X.textAlign = 'center';
                X.strokeText(title, W / 2, H * 0.075);
                X.fillStyle = '#e11d48';
                X.fillText(title, W / 2, H * 0.075);
                X.font = fnt('l', 800, 20 * u);
                X.fillStyle = '#111111';
                X.fillText(String(T('eyebrow') || '').toUpperCase(), W / 2, H * 0.115);

                const panelW = W * 0.41, panelH = H * 0.19, gap = W * 0.045;
                const left = W * 0.055, right = left + panelW + gap;
                const rows = [H * 0.16, H * 0.36];
                const panel = (x, y, w, h, rotate, bg, caption, filter) => {
                    X.save();
                    X.translate(x + w / 2, y + h / 2);
                    X.rotate(rotate);
                    X.translate(-(x + w / 2), -(y + h / 2));
                    X.fillStyle = bg;
                    X.fillRect(x, y, w, h);
                    X.save();
                    X.beginPath();
                    X.rect(x, y, w, h);
                    X.clip();
                    X.filter = filter;
                    photo(x, y, w, h);
                    X.filter = 'none';
                    X.restore();
                    X.strokeStyle = '#111111';
                    X.lineWidth = 6 * u;
                    X.strokeRect(x, y, w, h);
                    X.fillStyle = '#ffd84a';
                    X.fillRect(x, y, w * 0.62, 34 * u);
                    X.strokeRect(x, y, w * 0.62, 34 * u);
                    X.font = fnt('l', 800, 15 * u);
                    put(fitLine(caption, X.font, w * 0.56, 0), x + 12 * u, y + 17 * u, X.font, 0, 'l', '#111111');
                    X.restore();
                };
                panel(left, rows[0], panelW, panelH, -0.02, '#1b1b2f', String(T('line1')), 'brightness(.42) hue-rotate(200deg) saturate(1.5)');
                panel(right, rows[0], panelW, panelH, 0.02, '#3a2f7a', String(T('line2')), 'brightness(.35) saturate(1.8)');
                panel(left, rows[1], panelW, panelH, 0.015, '#ff8a3d', String(T('line3')), 'sepia(.6) saturate(1.4) brightness(.7)');
                panel(right, rows[1], panelW, panelH, -0.015, '#1b1b2f', String(T('title')), 'grayscale(1) brightness(.4)');

                // a speech burst in the second panel
                X.save();
                X.translate(right + panelW * 0.55, rows[0] + panelH * 0.55);
                X.rotate(-0.12);
                X.font = fnt('l', 800, 34 * u);
                X.strokeStyle = '#111111';
                X.lineWidth = 6 * u;
                X.textAlign = 'center';
                const shout = 'BOOOO!';
                X.strokeText(shout, 0, 0);
                X.fillStyle = '#e11d48';
                X.fillText(shout, 0, 0);
                X.restore();

                const dishY = H * 0.585, dishH = H * 0.2;
                X.fillStyle = '#f6c9dc';
                X.fillRect(W * 0.055, dishY, W * 0.89, dishH);
                X.strokeStyle = '#111111';
                X.lineWidth = 7 * u;
                X.strokeRect(W * 0.055, dishY, W * 0.89, dishH);
                stack([W * 0.09, dishY + H * 0.02, W * 0.6, dishH - H * 0.05], [
                    { k: 'title', z: 44, lh: 1.05, c: C('ink'), g: 10 },
                    { k: 'body', z: 20, f: 'l', lh: 1.35, c: C('ink') },
                ], { al: 'l', va: 'm' });
                pill(T('price'), W * 0.72, dishY + dishH * 0.42, 24 * u, C('ink'), '#f6c9dc', fnt('d', 700, 24 * u));
                X.font = fnt('l', 700, 18 * u);
                put(fitLine(footText(), X.font, W * 0.82, 0), W * 0.09, dishY + dishH - H * 0.012, X.font, 0, 'l', C('ink'));
            },
        }, {
            /* 3 · Pixel arcade — the ghost gets +100 three times. */
            n: 'Pixel arcade',
            animate: { line3: 0.2, eyebrow: 0.3, line1: 2.3, line2: 5.8, title: 7.5, body: 7.8, price: 8.0 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the pixel hero lands · 2–5s ghosts pop up, BOO! +100 each · 5–6s WARNING, empty plate · 7–9s the prize card',
            t: {
                eyebrow: 'FEAR 0% · 1UP',
                partner: 'GIOVANNIN',
                line1: 'BOO! +100',
                line2: 'WARNING! EMPTY?!',
                line3: 'SCORE 000100',
                title: 'Luxury Hot Chocolate',
                body: 'Incl. cream & marshmallows.',
                price: '£5.00',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                X.fillStyle = '#0a0a2a';
                X.fillRect(0, 0, W, H);
                X.fillStyle = 'rgba(154,163,255,.5)';
                for (let y = 24 * u; y < H; y += 60 * u) {
                    for (let x = 24 * u + (y % 120 === 24 * u ? 0 : 30 * u); x < W; x += 62 * u) X.fillRect(x, y, 4 * u, 4 * u);
                }
                X.font = fnt('l', 700, 22 * u);
                X.fillStyle = '#ffd23f';
                X.textAlign = 'left';
                X.fillText(String(T('line3') || 'SCORE 000100'), W * 0.05, H * 0.075);
                X.textAlign = 'right';
                X.fillText('1UP', W - W * 0.05, H * 0.075);
                X.textAlign = 'left';
                X.fillStyle = '#4cff7a';
                X.fillText(String(T('eyebrow') || 'FEAR 0%'), W * 0.05, H * 0.115);

                ghostSprite(W * 0.26, H * 0.3, W * 0.16, '#9aa3ff', '#0a0a2a');
                ghostSprite(W * 0.5, H * 0.24, W * 0.13, '#ff8ad8', '#0a0a2a');
                ghostSprite(W * 0.72, H * 0.31, W * 0.15, '#4cff7a', '#0a0a2a');
                X.font = fnt('l', 700, 30 * u);
                X.fillStyle = '#ffffff';
                X.fillText('BOO!', W * 0.3, H * 0.38);
                X.fillStyle = '#ffd23f';
                X.fillText('+100', W * 0.52, H * 0.42);
                X.fillStyle = '#ff3b5c';
                X.font = fnt('l', 700, 34 * u);
                X.fillText(String(T('line2') || 'WARNING! EMPTY?!'), W * 0.08, H * 0.5);

                // the prize card
                const cardY = H * 0.6, cardH = H * 0.19;
                X.fillStyle = '#10104a';
                X.fillRect(W * 0.06, cardY, W * 0.88, cardH);
                X.strokeStyle = '#ffd23f';
                X.lineWidth = 8 * u;
                X.strokeRect(W * 0.06, cardY, W * 0.88, cardH);
                stack([W * 0.1, cardY + cardH * 0.12, W * 0.8, cardH * 0.66], [
                    { k: 'title', z: 44, f: 'l', up: 1, lh: 1.1, c: '#ffd23f', g: 12 },
                    { k: 'body', z: 22, f: 'l', lh: 1.35, c: '#ffffff' },
                ], { al: 'c', va: 't' });
                X.font = fnt('l', 700, 38 * u);
                X.fillStyle = '#4cff7a';
                X.textAlign = 'center';
                X.fillText(String(T('price') || ''), W / 2, cardY + cardH * 0.9);

                X.font = fnt('l', 700, 18 * u);
                X.fillStyle = 'rgba(255,255,255,.7)';
                X.fillText(fitLine(footText(), X.font, W * 0.86, 0), W / 2, H * 0.87);
            },
        }, {
            /* 4 · Puppet theatre — the nose grows when he fibs. */
            n: 'Puppet theatre',
            animate: { eyebrow: 0.2, line1: 2.6, line2: 4.2, line3: 6.3, title: 1.6, body: 2.2, foot: 2.4, price: 7.4 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the curtains open on the theatre · 2–4s the puppet takes a bow · 4–7s the nose grows on the fib · 7–9s the price stamp and the dish',
            t: {
                eyebrow: 'Teatro Singl-end',
                partner: 'Pinocchio',
                line1: 'Me, lie? Never!',
                line2: 'The Limencello Spritz is… terrible.',
                line3: 'Fine! It’s delicious.',
                title: 'Limencello Spritz',
                body: 'Limencello, prosecco, soda.',
                price: '£10.50',
                foot: 'LIMENCELLO · PROSECCO · SODA',
            },
            draw(W, H) {
                const u = U;
                const gold = '#f2c14e';
                X.fillStyle = '#5a101c';
                X.fillRect(0, 0, W, H);
                for (let x = 0; x < W; x += 26 * u) {
                    X.fillStyle = x % (52 * u) === 0 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.04)';
                    X.fillRect(x, 0, 13 * u, H);
                }
                X.font = fnt('d', 800, 40 * u);
                X.textAlign = 'center';
                X.fillStyle = gold;
                X.fillText(String(T('eyebrow') || 'Teatro Singl-end').toUpperCase(), W / 2, H * 0.055);

                const winX = W * 0.08, winY = H * 0.09, winW = W * 0.84, winH = H * 0.46;
                X.save();
                X.beginPath();
                X.rect(winX, winY, winW, winH);
                X.clip();
                photo(winX, winY, winW, winH);
                X.fillStyle = 'rgba(0,0,0,.35)';
                X.fillRect(winX, winY, winW, winH);
                X.restore();
                X.strokeStyle = '#c8902a';
                X.lineWidth = 14 * u;
                X.strokeRect(winX, winY, winW, winH);

                // curtains, opening on cue
                const open = easeOut(phase(0.3, 1.4));
                X.fillStyle = '#a3182d';
                X.save();
                X.translate(-winW * 0.9 * open, 0);
                X.beginPath();
                X.moveTo(winX, winY);
                X.lineTo(winX + winW * 0.16, winY);
                X.quadraticCurveTo(winX + winW * 0.06, winY + winH * 0.5, winX + winW * 0.12, winY + winH);
                X.lineTo(winX, winY + winH);
                X.closePath();
                X.fill();
                X.restore();
                X.save();
                X.translate(winW * 0.9 * open, 0);
                X.beginPath();
                X.moveTo(winX + winW, winY);
                X.lineTo(winX + winW * 0.84, winY);
                X.quadraticCurveTo(winX + winW * 0.94, winY + winH * 0.5, winX + winW * 0.88, winY + winH);
                X.lineTo(winX + winW, winY + winH);
                X.closePath();
                X.fill();
                X.restore();

                // strings from the flies
                X.strokeStyle = 'rgba(255,255,255,.35)';
                X.lineWidth = 1.6 * u;
                [[0.3, 0.14], [0.26, 0.52], [0.34, 0.52]].forEach(([sx, sy]) => {
                    X.beginPath();
                    X.moveTo(W * sx, winY);
                    X.lineTo(W * sx + (sx < 0.3 ? -6 * u : 6 * u), winY + winH * sy);
                    X.stroke();
                });
                puppet(W * 0.3, winY + winH * 0.92, winH * 0.62, '#d8a05a', '#c88c55', winW * 0.14);

                bubble(String(T('line1')), W * 0.4, winY + winH * 0.1, W * 0.42, 20 * u, '#fbf3df', C('ink'), 'l');
                bubble(String(T('line2')), W * 0.3, winY + winH * 0.34, W * 0.52, 19 * u, '#fbf3df', C('ink'), 'l');
                bubble(String(T('line3')), W * 0.36, winY + winH * 0.58, W * 0.46, 19 * u, '#fbf3df', C('ink'), 'l');

                // price stamp
                X.save();
                X.translate(W * 0.62, H * 0.63);
                X.rotate(-0.09);
                X.fillStyle = '#b07a45';
                X.fillRect(-W * 0.2, -46 * u, W * 0.4, 92 * u);
                X.strokeStyle = '#5a3a1d';
                X.lineWidth = 6 * u;
                X.strokeRect(-W * 0.2, -46 * u, W * 0.4, 92 * u);
                X.font = fnt('d', 800, 44 * u);
                X.textAlign = 'center';
                X.fillStyle = '#fbf3df';
                X.fillText(String(T('price') || ''), 0, 4 * u);
                X.restore();

                stack([W * 0.06, H * 0.68, W * 0.88, H * 0.12], [
                    { k: 'title', z: 62, lh: 1.02, c: gold },
                ], { al: 'c', va: 't' });
                stack([W * 0.12, H * 0.775, W * 0.76, H * 0.08], [
                    { k: 'body', z: 26, f: 'l', lh: 1.3, c: '#fbf3df' },
                    { k: 'foot', z: 18, f: 'l', up: 1, ls: .16, c: 'rgba(251,243,223,.85)', g: 14 },
                ], { al: 'c', va: 't' });
                rule(W * 0.12, H * 0.945, W * 0.76, 2 * u, 'rgba(242,193,78,.6)');
            },
        }, {
            /* 5 · Storybook — a page turns and the nose stays the same. */
            n: 'Storybook',
            animate: { eyebrow: 0.4, title: 0.8, line1: 1.6, body: 2.6, price: 3.4, line2: 4.2, foot: 4.6 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the page turns · 2–4s Capitolo II is set · 4–6s the illustration and dish · 6–8s the closing line',
            t: {
                eyebrow: 'Capitolo II',
                partner: 'Pinocchio',
                line1: 'In which a wooden boy walks into Singl-end',
                line2: 'And his nose never grew, not once.',
                title: 'The Everything',
                body: 'Avocado & chilli smash, grilled tomatoes, crumbled feta, poached eggs, Italian pangrattato & toasted sourdough.',
                price: '£14.50',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                const ink = '#3b2a1a';
                X.fillStyle = '#ecdcb4';
                X.fillRect(0, 0, W, H);
                grad(0, 0, W, H, '#7a4e1f', .0, .18);
                X.strokeStyle = 'rgba(59,42,26,.55)';
                X.lineWidth = 3 * u;
                X.strokeRect(W * 0.045, H * 0.035, W * 0.91, H * 0.93);
                X.lineWidth = 1.5 * u;
                X.strokeRect(W * 0.06, H * 0.048, W * 0.88, H * 0.904);

                X.font = fnt('l', 700, 20 * u);
                X.textAlign = 'center';
                X.fillStyle = ink;
                X.fillText(String(T('eyebrow') || 'Capitolo II').toUpperCase(), W / 2, H * 0.09);

                stack([W * 0.1, H * 0.115, W * 0.8, H * 0.12], [
                    { k: 'title', z: 64, f: 'b', lh: 1.02, c: ink },
                ], { al: 'c', va: 't' });

                const cx = W * 0.5, cy = H * 0.315, r = W * 0.19;
                const uncover = easeOut(phase(0.7, 1.2));
                X.save();
                X.beginPath();
                X.arc(cx, cy, r, 0, Math.PI * 2);
                X.clip();
                X.beginPath();
                X.rect(cx - r, cy - r + 2 * r * (1 - uncover), 2 * r, 2 * r * uncover);
                X.clip();
                X.filter = 'sepia(.5) contrast(1.1)';
                photo(cx - r, cy - r, r * 2, r * 2);
                X.filter = 'none';
                X.restore();
                X.strokeStyle = ink;
                X.lineWidth = 3 * u;
                X.beginPath();
                X.arc(cx, cy, r, 0, Math.PI * 2);
                X.stroke();

                X.font = fnt('b', 500, 26 * u);
                X.fillStyle = ink;
                X.fillText(String(T('line1') || ''), W / 2, H * 0.5);

                stack([W * 0.12, H * 0.53, W * 0.76, H * 0.12], [
                    { k: 'body', z: 25, f: 'l', lh: 1.45, c: ink },
                ], { al: 'c', va: 't' });

                X.save();
                X.translate(W * 0.5, H * 0.7);
                X.rotate(-0.05);
                X.strokeStyle = ink;
                X.lineWidth = 3 * u;
                X.beginPath();
                X.arc(0, 0, W * 0.11, 0, Math.PI * 2);
                X.stroke();
                X.font = fnt('b', 700, 38 * u);
                X.fillStyle = ink;
                X.fillText(String(T('price') || ''), 0, 12 * u);
                X.restore();

                X.font = fnt('b', 500, 24 * u);
                X.fillText(String(T('line2') || ''), W / 2, H * 0.85);
                X.font = fnt('l', 600, 17 * u);
                X.fillText(fitLine(footText(), X.font, W * 0.8, 0), W / 2, H * 0.9);
            },
        }, {
            /* 6 · Truth or Nose? — a game show that catches the lie. */
            n: 'Truth or Nose?',
            animate: { eyebrow: 0.2, line1: 1.2, line2: 2.3, line3: 3.2, title: 7.2, body: 7.5, price: 7.8 },
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the wheel spins and the title lands · 2–5s statement one, TRUE stamp · 5–7s BZZT, the lie · 7–9s the dish card',
            t: {
                eyebrow: 'Truth or Nose?',
                partner: 'Pinocchio',
                line1: 'It has avocado & pickled purple cabbage.',
                line2: 'TRUE ✔',
                line3: 'It costs £140.  LIE ✘',
                title: 'Rainbow Open Sandwich',
                body: 'Roasted beetroot & toasted cumin hummus, avocado, pickled purple cabbage, flamed peppers, sourdough.',
                price: '£14.00',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                X.fillStyle = '#2a0a5a';
                X.fillRect(0, 0, W, H);
                X.save();
                X.translate(W / 2, H * 0.34);
                for (let i = 0; i < 24; i += 1) {
                    X.rotate(Math.PI / 12);
                    X.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)';
                    X.beginPath();
                    X.moveTo(0, 0);
                    X.lineTo(W * 0.9, -W * 0.06);
                    X.lineTo(W * 0.9, W * 0.06);
                    X.closePath();
                    X.fill();
                }
                X.restore();
                X.fillStyle = 'rgba(90,31,162,.55)';
                X.fillRect(0, 0, W, H);

                X.font = fnt('d', 800, 62 * u);
                X.textAlign = 'center';
                X.fillStyle = '#c2185b';
                X.fillText(String(T('eyebrow') || 'Truth or Nose?'), W / 2, H * 0.085);
                X.fillStyle = '#ffd23f';
                X.fillText(String(T('eyebrow') || 'Truth or Nose?'), W / 2, H * 0.085 - 5 * u);

                // statement cards
                const cardY = H * 0.155, cardH = H * 0.105;
                X.fillStyle = 'rgba(10,4,30,.82)';
                X.fillRect(W * 0.07, cardY, W * 0.86, cardH);
                X.strokeStyle = '#ffd23f';
                X.lineWidth = 5 * u;
                X.strokeRect(W * 0.07, cardY, W * 0.86, cardH);
                stack([W * 0.11, cardY + cardH * 0.2, W * 0.78, cardH * 0.6], [
                    { k: 'line1', z: 30, f: 'l', lh: 1.25, c: '#ffffff' },
                ], { al: 'c', va: 't' });
                X.save();
                X.translate(W * 0.72, cardY + cardH * 0.92);
                X.rotate(-0.12);
                X.font = fnt('l', 800, 34 * u);
                X.fillStyle = '#4cff7a';
                X.textAlign = 'center';
                X.fillText(String(T('line2') || 'TRUE ✔'), 0, 0);
                X.restore();

                X.font = fnt('l', 800, 30 * u);
                X.fillStyle = '#ff3b5c';
                X.textAlign = 'left';
                X.fillText('BZZT!', W * 0.1, H * 0.31);
                X.font = fnt('l', 700, 22 * u);
                X.fillStyle = '#ffffff';
                X.fillText(fitLine(String(T('line3') || ''), X.font, W * 0.72, 0), W * 0.1, H * 0.355);
                X.save();
                X.translate(W * 0.83, H * 0.352);
                X.rotate(-0.16);
                X.strokeStyle = '#ff3b5c';
                X.lineWidth = 5 * u;
                X.font = fnt('l', 800, 26 * u);
                const lieW = tw('LIE ✘', X.font, 0) + 30 * u;
                X.strokeRect(-lieW / 2, -30 * u, lieW, 60 * u);
                X.fillStyle = '#ff3b5c';
                X.textAlign = 'center';
                X.fillText('LIE ✘', 0, 2 * u);
                X.restore();

                const dishY = H * 0.42, dishH = H * 0.2;
                X.fillStyle = 'rgba(10,4,30,.9)';
                X.fillRect(W * 0.06, dishY, W * 0.88, dishH);
                X.strokeStyle = '#ffd23f';
                X.lineWidth = 8 * u;
                X.strokeRect(W * 0.06, dishY, W * 0.88, dishH);
                stack([W * 0.1, dishY + dishH * 0.12, W * 0.8, dishH * 0.64], [
                    { k: 'title', z: 42, f: 'l', up: 1, lh: 1.08, c: '#ffd23f', g: 12 },
                    { k: 'body', z: 21, f: 'l', lh: 1.35, c: '#ffffff' },
                ], { al: 'c', va: 't' });
                X.font = fnt('l', 700, 36 * u);
                X.fillStyle = '#4cff7a';
                X.fillText(String(T('price') || ''), W / 2, dishY + dishH * 0.9);

                X.font = fnt('l', 600, 18 * u);
                X.fillStyle = 'rgba(255,255,255,.7)';
                X.fillText(fitLine(footText(), X.font, W * 0.86, 0), W / 2, H * 0.72);
            },
        }, {
            /* 7 · Le Regole della Nonna — a series card, one rule per episode. */
            n: 'Le Regole della Nonna',
            dishFields: ['title', 'body', 'price', 'foot'],
            motion: '0–2s the camera drifts across the scene · 2–4s the rule card slides up · 4–7s the Italian rule and its translation · 7–9s the dish and the NONNA APPROVED stamp',
            animate: { partner: 0.1, eyebrow: 0.25, kicker: 0.9, line1: 1.1, line2: 1.5, line3: 2.6, title: 7.6, body: 7.9, price: 8.2, foot: 8.7 },
            t: {
                partner: 'Le Regole della Nonna',
                eyebrow: 'Episodio 1 di 3 · ●○○',
                kicker: 'Regola uno',
                line1: 'Regola uno: nessuno esce affamato.',
                line2: 'Rule one: nobody leaves hungry.',
                line3: 'Nonna mescola. Nonna decide.',
                title: 'Meaty Baked Eggs',
                body: 'Chilli & fennel sausage, oven-baked onions, homemade tomato & butter bean casserole, toasted sourdough.',
                price: '£14.75',
                foot: '@singlendcafe_glasgow',
            },
            draw(W, H) {
                const u = U;
                const cream = '#fff7e8';
                const red = '#a8202c';
                const navy = C('ink');
                X.fillStyle = cream;
                X.fillRect(0, 0, W, H);

                // camera tour: a slow push across the whole ten seconds
                const pan = animTime() == null ? 1 : Math.min(1, (animTime() || 0) / 10);
                const winY = H * 0.22, winH = H * 0.46;
                X.save();
                X.beginPath();
                X.rect(0, winY, W, winH);
                X.clip();
                X.translate(W / 2, winY + winH / 2);
                X.scale(1.02 + pan * 0.1, 1.02 + pan * 0.1);
                X.translate(-W / 2 + (pan - 0.5) * W * 0.06, -(winY + winH / 2));
                photo(0, winY, W, winH);
                X.restore();
                X.fillStyle = 'rgba(42,18,8,.18)';
                X.fillRect(0, winY, W, winH);
                X.fillStyle = red;
                X.fillRect(0, winY + winH - 6 * u, W, 6 * u);

                // header: checked band with the series pill
                const bandY = H * 0.05, bandH = H * 0.15;
                for (let y = 0; y < bandH; y += 40 * u) {
                    for (let x = 0; x < W; x += 40 * u) {
                        X.fillStyle = ((x / (40 * u)) + (y / (40 * u))) % 2 ? 'rgba(168,32,44,.85)' : 'rgba(255,247,232,.95)';
                        X.fillRect(x, bandY + y, 40 * u, 40 * u);
                    }
                }
                X.fillStyle = 'rgba(255,247,232,.94)';
                X.beginPath();
                X.roundRect(W * 0.1, bandY + bandH * 0.18, W * 0.8, bandH * 0.64, bandH * 0.32);
                X.fill();
                X.strokeStyle = red;
                X.lineWidth = 4 * u;
                X.stroke();
                X.font = fnt('b', 700, 46 * u);
                X.textAlign = 'center';
                X.fillStyle = red;
                X.fillText(String(T('partner') || 'Le Regole della Nonna'), W / 2, bandY + bandH * 0.44);
                X.font = fnt('l', 700, 19 * u);
                X.fillStyle = navy;
                X.fillText(String(T('eyebrow') || '').toUpperCase(), W / 2, bandY + bandH * 0.7);

                // the rule card slides up over the photograph
                const slide = easeOut(phase(0.4, 0.9));
                const cardY = H * (0.95 - 0.43 * slide);
                const cardH = H * 0.42;
                X.fillStyle = cream;
                X.beginPath();
                X.roundRect(W * 0.05, cardY, W * 0.9, cardH, 26 * u);
                X.fill();
                X.strokeStyle = red;
                X.lineWidth = 6 * u;
                X.stroke();

                withElement('kicker', () => {
                    X.fillStyle = red;
                    X.beginPath();
                    X.roundRect(W * 0.07, cardY - 22 * u, W * 0.42, 52 * u, 26 * u);
                    X.fill();
                    X.font = fnt('b', 700, 30 * u);
                    X.textAlign = 'center';
                    X.fillStyle = cream;
                    X.fillText(String(T('kicker') || ''), W * 0.07 + W * 0.21, cardY - 22 * u + 27 * u);
                });

                stack([W * 0.09, cardY + H * 0.045, W * 0.82, H * 0.1], [
                    { k: 'line1', z: 44, f: 'b', lh: 1.08, c: red },
                    { k: 'line2', z: 22, f: 'l', lh: 1.3, c: navy, g: 10 },
                    { k: 'line3', z: 22, f: 'b', lh: 1.3, c: mix(navy, cream, .3), g: 16 },
                ], { al: 'l', va: 't' });

                const dishY = cardY + H * 0.2;
                withElement('title', () => {
                    dashed(W * 0.09, dishY, W * 0.82, 'rgba(168,32,44,.35)', 2 * u);
                    X.font = fnt('l', 800, 17 * u);
                    X.textAlign = 'left';
                    X.fillStyle = red;
                    X.fillText('NONNA APPROVED ✔', W * 0.09, dishY + 34 * u);
                });
                stack([W * 0.09, dishY + 48 * u, W * 0.82, H * 0.1], [
                    { k: 'title', z: 54, f: 'b', lh: 1.02, c: red },
                    { k: 'body', z: 21, f: 'l', lh: 1.35, c: navy, g: 10 },
                    { k: 'price', z: 34, f: 'b', c: red, g: 14 },
                ], { al: 'l', va: 't' });

                // the stamp
                const stampIn = easeOut(phase(8.3, 0.6));
                if (stampIn > 0.01) {
                    X.save();
                    X.translate(W * 0.8, cardY + cardH - H * 0.1);
                    X.rotate(-0.18);
                    X.scale(0.6 + 0.4 * stampIn, 0.6 + 0.4 * stampIn);
                    X.strokeStyle = red;
                    X.lineWidth = 6 * u;
                    X.beginPath();
                    X.arc(0, 0, W * 0.09, 0, Math.PI * 2);
                    X.stroke();
                    X.beginPath();
                    X.arc(0, 0, W * 0.075, 0, Math.PI * 2);
                    X.stroke();
                    X.font = fnt('l', 800, 17 * u);
                    X.textAlign = 'center';
                    X.fillStyle = red;
                    X.fillText('NONNA', 0, -14 * u);
                    X.fillText('APPROVED', 0, 12 * u);
                    X.restore();
                }

                withElement('foot', () => {
                    X.font = fnt('l', 700, 20 * u);
                    X.textAlign = 'center';
                    X.fillStyle = mix(navy, cream, .25);
                    X.fillText(fitLine(footText(), X.font, W * 0.9, 0), W / 2, H * 0.945);
                });
            },
        }],
    };
    window.AssetCategories['storyidea'] = CFG;
})();

/* =====================================================================
 * Expansion — next 25 designs
 * Signage & posters, extended menus, guest cards, stationery, packaging,
 * extended social, compliance. Sizes carry physical mm (for the print
 * pack), a `shape` for die-cuts, `sides` for two-sided items and
 * `print:false` for screen-only presets.
 * ===================================================================== */

(function () {
    // Two-column item board used by the digital menu board.
    function boardColumns(rect, options = {}) {
        const [x, y, width, height] = rect;
        const rows = parseRows(T('items'));
        const columns = Math.max(1, Math.min(2, options.columns || 2));
        const scale = options.scale || 1;
        const gap = width * 0.05;
        const colW = (width - gap * (columns - 1)) / columns;
        // Split at a section heading so a column never ends with a bare heading.
        let split = Math.ceil(rows.length / columns);
        for (let offset = 0; offset < rows.length; offset += 1) {
            const candidate = Math.ceil(rows.length / columns) + offset;
            if (candidate > 0 && candidate < rows.length && rows[candidate] && rows[candidate].h) {
                split = candidate;
                break;
            }
        }
        while (split > 1 && rows[split - 1] && rows[split - 1].h) split -= 1;
        const columnChunks = columns === 1 ? [rows] : [rows.slice(0, split), rows.slice(split)];
        const headingH = 40 * U * scale;
        const itemH = 56 * U * scale;
        const natural = rows.reduce((sum, row) => sum + (row.h ? headingH : itemH), 0);
        const extra = options.fill ? Math.max(0, (height - natural) / Math.max(1, rows.length)) : 0;
        columnChunks.forEach((chunk, column) => {
            const left = x + column * (colW + gap);
            let cursor = y;
            chunk.forEach((row) => {
                if (row.h) {
                    put(row.h.toUpperCase(), left, cursor + 12 * U * scale, fnt('l', 700, 15 * U * scale), 1.4 * U, 'l', C('accent'));
                    X.strokeStyle = mix(C('paper'), C('ink'), 0.25);
                    X.lineWidth = Math.max(1, 1 * U);
                    X.beginPath();
                    X.moveTo(left, cursor + 22 * U * scale);
                    X.lineTo(left + colW, cursor + 22 * U * scale);
                    X.stroke();
                    cursor += headingH + extra;
                    return;
                }
                const cells = row.cells || [];
                put(cells[0] || '', left, cursor + 10 * U * scale, fnt('d', 600, 24 * U * scale), 0, 'l', C('ink'));
                if (cells[1]) put(cells[1], left, cursor + 32 * U * scale, fnt('b', 400, 15 * U * scale), 0, 'l', C('mute'));
                if (cells[2]) put(cells[2], left + colW, cursor + 12 * U * scale, fnt('d', 600, 24 * U * scale), 0, 'r', C('ink'));
                cursor += itemH + extra;
            });
        });
        if (!rows.length) {
            put('Add dishes in the Text tab, one per line:', x, y + 20 * U, fnt('b', 400, 18 * U), 0, 'l', C('mute'));
        }
        return options;
    }

    const SIZES = [
        { n: 'A1 portrait', d: 'Print · 594×841 mm · 100 dpi', w: 2339, h: 3311, mm: [594, 841], dpi: 100, largeFormat: true },
        { n: 'A3 portrait', d: 'Print · 297×420 mm · 150 dpi', w: 1754, h: 2480, mm: [297, 420], dpi: 150 },
        { n: 'A2 portrait', d: 'Print · 420×594 mm · 100 dpi', w: 1654, h: 2339, mm: [420, 594], dpi: 100, largeFormat: true },
        { n: 'Landscape 16:9', d: 'Screen · 1920×1080', w: 1920, h: 1080, print: false },
        { n: 'Portrait 9:16', d: 'Screen · 1080×1920', w: 1080, h: 1920, print: false },
        { n: 'Roll-up 850×2000', d: 'Print · 850×2000 mm · 50 dpi', w: 1673, h: 3937, mm: [850, 2000], dpi: 50, largeFormat: true },
        { n: 'A4 portrait', d: 'Print · 210×297 mm · 150 dpi', w: 1240, h: 1754, mm: [210, 297], dpi: 150 },
        { n: 'A5 portrait', d: 'Print · 148×210 mm · 150 dpi', w: 874, h: 1240, mm: [148, 210], dpi: 150 },
        { n: 'DL', d: 'Print · 99×210 mm · 150 dpi', w: 585, h: 1240, mm: [99, 210], dpi: 150 },
    ];

    const CFG = {
        id: 'signage',
        title: 'Signage & Poster Maker',
        sub: 'Pavement boards, posters, screens, banners and notices.',
        sizes: SIZES,
        fields: [],
        tpls: [
            {
                n: 'A-board special', sizes: ['A1 portrait'],
                t: {
                    eyebrow: 'Today at the pass',
                    title: 'Lunch, sorted.',
                    items: 'Charcoal-grilled beef | £16\nWild mushroom tart | £13\nSoup of the day | £8',
                    foot: 'www.thephysician.bar · 129 South Street, St Andrews',
                },
                draw(W, H) {
                    R(0, 0, W, H, 'ink');
                    const p = W * 0.08;
                    const board = C('paper');
                    X.strokeStyle = mix(C('ink'), C('paper'), 0.35);
                    X.lineWidth = Math.max(2, W * 0.004);
                    X.strokeRect(W * 0.03, H * 0.025, W * 0.94, H * 0.95);
                    logoAt(p, H * 0.07, W * 0.055, board, 'l', 0.5);
                    put(T('eyebrow').toUpperCase(), p, H * 0.17, fnt('l', 700, 24 * U), 4 * U, 'l', C('accent'));
                    stack([p, H * 0.2, W - 2 * p, H * 0.2], [{ k: 'title', z: 108, c: board, lh: 1.04 }], { al: 'l', va: 't' });
                    let y = H * 0.44;
                    const rows = parseRows(T('items'));
                    rows.forEach((row) => {
                        if (row.h) {
                            put(row.h.toUpperCase(), p, y, fnt('l', 700, 20 * U), 3 * U, 'l', C('accent'));
                            y += 38 * U;
                            return;
                        }
                        const cells = row.cells || [];
                        put(cells[0] || '', p, y, fnt('d', 600, 34 * U), 0, 'l', board);
                        if (cells[1]) put(cells[1], W - p, y, fnt('d', 600, 34 * U), 0, 'r', board);
                        X.strokeStyle = mix(C('ink'), C('paper'), 0.3);
                        X.setLineDash([2 * U, 6 * U]);
                        X.beginPath();
                        X.moveTo(p, y + 26 * U);
                        X.lineTo(W - p, y + 26 * U);
                        X.stroke();
                        X.setLineDash([]);
                        y += 64 * U;
                    });
                    drawMotif('rod', W / 2, H * 0.74, H * 0.15, mix(C('ink'), C('paper'), 0.6), C('accent'));
                    put('Kitchen open 12–9pm · walk-ins welcome', p, H * 0.855, fnt('b', 400, 22 * U), 0, 'l', mix(C('ink'), C('paper'), 0.75));
                    put(T('foot'), p, H * 0.93, fnt('b', 400, 20 * U), 0, 'l', board);
                },
            },
            {
                n: 'Event poster', sizes: ['A3 portrait', 'A2 portrait'], ph: 1, pi: 'cocktail',
                t: {
                    eyebrow: 'Live music',
                    title: 'Saturday sessions',
                    date: 'Saturday 14 November · 8pm',
                    act: 'The Late Set · support from Maeve Quinn',
                    cta: 'Free entry · book a table',
                    foot: 'www.thephysician.bar',
                },
                draw(W, H) {
                    photo(0, 0, W, H);
                    grad(0, 0, W, H * 0.75, '#0e0e1a', 0.15, 0.94);
                    grad(0, H * 0.45, W, H * 0.55, '#0e0e1a', 0.1, 0.95);
                    const p = W * 0.1;
                    logoAt(p, H * 0.06, W * 0.05, '#f6f1ea', 'l', 0.5);
                    put(T('eyebrow').toUpperCase(), p, H * 0.2, fnt('l', 700, 22 * U), 4 * U, 'l', C('accent'));
                    stack([p, H * 0.24, W - 2 * p, H * 0.3], [{ k: 'title', z: 126, c: '#f6f1ea', lh: 1.02 }], { al: 'l', va: 't' });
                    put(T('date'), p, H * 0.57, fnt('d', 600, 36 * U), 0, 'l', '#f6f1ea');
                    put(T('act'), p, H * 0.63, fnt('b', 400, 24 * U), 0, 'l', '#d8d2c8');
                    X.fillStyle = C('accent');
                    X.fillRect(p, H * 0.72, W * 0.32, 4 * U);
                    put(T('cta').toUpperCase(), p, H * 0.78, fnt('l', 700, 22 * U), 3 * U, 'l', '#f6f1ea');
                    put(T('foot'), p, H * 0.93, fnt('b', 400, 20 * U), 0, 'l', '#c9c3ba');
                },
            },
            {
                n: 'Digital menu board', sizes: ['Landscape 16:9', 'Portrait 9:16'], profile: 'screen',
                hint: 'One item per line: Name | Description | Price. Start a section with #.',
                t: {
                    title: 'All day menu',
                    sub: 'Kitchen open 12–9pm',
                    items: '# Small plates\nOysters, shallot vinegar | Six, shucked to order | £18\nCured salmon, dill oil | Rye, pickled cucumber | £12\n# Mains\nDry-aged beef, bone marrow | Charcoal-grilled, watercress | £34\nWild mushroom tart | Truffle, aged parmesan | £22\n# Drinks\nNegroni | Gin, vermouth, bitter orange | £11',
                    foot: 'Order at the bar · www.thephysician.bar',
                },
                draw(W, H) {
                    R(0, 0, W, H, 'paper');
                    const p = W * 0.055;
                    const portrait = H > W;
                    R(0, 0, W, H * 0.005, 'accent');
                    logoAt(p, H * (portrait ? 0.06 : 0.07), H * 0.055, 'ink', 'l', 0.4);
                    if (portrait) {
                        put(T('title'), p, H * 0.145, fnt('d', 600, 54 * U), 0, 'l', C('ink'));
                        put(T('sub').toUpperCase(), p, H * 0.185, fnt('l', 700, 16 * U), 3 * U, 'l', C('mute'));
                    } else {
                        put(T('title'), W - p, H * 0.1, fnt('d', 600, 58 * U), 0, 'r', C('ink'));
                        put(T('sub').toUpperCase(), W - p, H * 0.17, fnt('l', 700, 18 * U), 3 * U, 'r', C('mute'));
                    }
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(2, 3 * U);
                    X.beginPath();
                    X.moveTo(p, H * (portrait ? 0.225 : 0.22));
                    X.lineTo(W - p, H * (portrait ? 0.225 : 0.22));
                    X.stroke();
                    boardColumns([p, H * 0.265, W - 2 * p, H * 0.62], {
                        columns: portrait ? 1 : 2,
                        scale: portrait ? 1.7 : 1,
                        fill: portrait,
                    });
                    put(T('foot'), p, H * 0.94, fnt('b', 400, 18 * U), 0, 'l', C('mute'));
                },
            },
            {
                n: 'Roll-up banner', sizes: ['Roll-up 850×2000'], ph: 1, pi: 'voucher', q: 1,
                t: {
                    eyebrow: 'Scottish produce · warm welcome',
                    title: 'Find your cure.',
                    sub: 'Dinner, drinks and rooms in the heart of St Andrews.',
                    cta: 'Book at www.thephysician.bar',
                    foot: '129 South Street, St Andrews',
                },
                draw(W, H) {
                    R(0, 0, W, H, 'ink');
                    photo(W * 0.06, H * 0.28, W * 0.88, H * 0.38, W * 0.02);
                    logoAt(W / 2, H * 0.06, W * 0.09, 'paper', 'c', 0.55);
                    put(T('eyebrow').toUpperCase(), W / 2, H * 0.2, fnt('l', 700, 22 * U), 3 * U, 'c', C('accent'));
                    stack([W * 0.07, H * 0.7, W * 0.86, H * 0.14], [{ k: 'title', z: 96, c: C('paper'), lh: 1.02 }], { al: 'c', va: 't' });
                    stack([W * 0.1, H * 0.76, W * 0.8, H * 0.06], [{ k: 'sub', z: 30, c: C('paper'), f: 'b' }], { al: 'c', va: 't' });
                    qrAt(W / 2 - W * 0.09, H * 0.84, W * 0.18, 1);
                    put(T('cta'), W / 2, H * 0.945, fnt('l', 700, 20 * U), 3 * U, 'c', C('paper'));
                    put(T('foot'), W / 2, H * 0.975, fnt('b', 400, 16 * U), 0, 'c', mix(C('paper'), C('ink'), 0.35));
                },
            },
            {
                n: 'Opening hours & notice sign', sizes: ['A4 portrait', 'A5 portrait', 'DL'],
                t: {
                    eyebrow: 'Please wait to be seated',
                    title: 'Opening hours',
                    lines: 'Monday – Thursday | 12pm – 11pm\nFriday – Saturday | 12pm – 1am\nSunday | 12pm – 10pm',
                    note: 'Kitchen closes 45 minutes before the bar.',
                    foot: 'www.thephysician.bar',
                },
                draw(W, H) {
                    R(0, 0, W, H, 'paper');
                    const p = W * 0.1;
                    R(0, 0, W, H * 0.012, 'accent');
                    logoAt(p, H * 0.06, W * 0.05, 'ink', 'l', 0.5);
                    put(T('eyebrow').toUpperCase(), p, H * 0.16, fnt('l', 700, 18 * U), 3 * U, 'l', C('accent'));
                    stack([p, H * 0.19, W - 2 * p, H * 0.18], [{ k: 'title', z: 92, lh: 1.03 }], { al: 'l', va: 't' });
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(2, 2 * U);
                    X.beginPath();
                    X.moveTo(p, H * 0.4);
                    X.lineTo(p + W * 0.24, H * 0.4);
                    X.stroke();
                    let y = H * 0.46;
                    parseRows(T('lines')).forEach((row) => {
                        const cells = row.cells || [];
                        put(cells[0] || '', p, y, fnt('d', 600, 34 * U), 0, 'l', C('ink'));
                        put(cells[1] || '', W - p, y, fnt('d', 400, 34 * U), 0, 'r', C('ink'));
                        y += 58 * U;
                    });
                    stack([p, H * 0.74, W - 2 * p, H * 0.1], [{ k: 'note', z: 22, f: 'b', c: 'mute' }], { al: 'l', va: 't' });
                    put(T('foot'), p, H * 0.93, fnt('b', 400, 17 * U), 0, 'l', C('mute'));
                },
            },
        ],
    };
    window.AssetCategories.signage = CFG;
})();

(function () {
    const cfg = window.AssetCategories.menu;
    if (!cfg) return;
    cfg.sizes.push(
        { n: 'A5 portrait', d: 'Print · 148×210 mm · 150 dpi', w: 874, h: 1240, mm: [148, 210], dpi: 150 },
        { n: 'A4 landscape', d: 'Print · 297×210 mm · 150 dpi', w: 1754, h: 1240, mm: [297, 210], dpi: 150 },
    );
    ['Classic', 'Festive', 'Centred', 'Photo header'].forEach((name) => {
        const tpl = cfg.tpls.find((item) => item.n === name);
        if (tpl) tpl.sizes = ['A4 portrait', 'Slim DL', 'Story 9:16'];
    });
    cfg.tpls.push(
        {
            n: 'Drinks / cocktail list', sizes: ['A4 portrait', 'A5 portrait', 'Slim DL'],
            hint: 'One drink per line: Name | Description | Price. Start a section with #.',
            t: {
                sub: 'Cocktails & spirits',
                title: 'The drinks list',
                items: '# Cocktails\nNegroni | Gin, vermouth, bitter orange | £11\nEspresso martini | Vodka, coffee liqueur, espresso | £12\n# Draught\nHouse lager | 330ml | £6\nPale ale | 330ml | £6.5\n# Spirits\nSingle malt | Ask for today’s list | £8',
                foot: '129 South Street, St Andrews · www.thephysician.bar',
            },
            draw(W, H) {
                const p = W * 0.09;
                R(0, 0, W, H, 'paper');
                R(0, 0, W * 0.015, H, 'accent');
                logoAt(p, H * 0.05, W * 0.05, 'ink', 'l', 0.5);
                stack([p, H * 0.14, W - 2 * p, H * 0.16], [
                    { k: 'sub', z: 20, f: 'l', c: 'accent', up: 1, ls: .28, g: 30 },
                    { k: 'title', z: 74, g: 16 },
                ], { al: 'l', va: 't' });
                glass(W - p - W * 0.13, H * 0.05, H * 0.2, C('ink'), C('accent'));
                menuList([p, H * 0.36, W - 2 * p, H * 0.55], { zn: 38, zd: 24, zp: 36, g: 54, zh: 19, wn: 600 });
                stack([p, H * 0.93, W - 2 * p, H * 0.04], [{ k: 'foot', z: 17, f: 'l', c: 'mute' }], { al: 'l', va: 't' });
            },
        },
        {
            n: 'Wine list', sizes: ['A4 portrait'],
            hint: 'One wine per line: Name | Region / grape | Glass price | Bottle price. # starts a section.',
            t: {
                sub: 'Wine & aperitifs',
                title: 'Wine list',
                wines: '# By the glass\nPicpoul de Pinet | Languedoc, France | 7.5 | 32\nRioja Crianza | Rioja, Spain | 8 | 36\n# White\nChablis | Burgundy, France | 11 | 48\nAlbariño | Rías Baixas, Spain | 10 | 42\n# Red\nChianti Classico | Tuscany, Italy | 10.5 | 44\nMalbec | Mendoza, Argentina | 9.5 | 40\n# Sparkling\nChampagne brut | Reims, France | 14 | 78',
                foot: 'A discretionary 10% service charge applies to parties of six or more.',
            },
            draw(W, H) {
                const p = W * 0.08;
                R(0, 0, W, H, 'paper');
                R(p, H * 0.055, W - 2 * p, H * 0.004, 'accent');
                logoAt(p, H * 0.075, W * 0.045, 'ink', 'l', 0.5);
                stack([p, H * 0.14, W - 2 * p, H * 0.15], [
                    { k: 'sub', z: 19, f: 'l', c: 'accent', up: 1, ls: .3, g: 22 },
                    { k: 'title', z: 64, g: 12 },
                ], { al: 'l', va: 't' });
                wineList([p, H * 0.34, W - 2 * p, H * 0.56], { columns: 2, zn: 33, zd: 18, zp: 24, g: 20, zh: 18 });
                stack([p, H * 0.93, W - 2 * p, H * 0.04], [{ k: 'foot', z: 15, f: 'b', c: 'mute' }], { al: 'l', va: 't' });
            },
        },
        {
            n: 'Kids menu', sizes: ['A4 landscape', 'A4 portrait'],
            t: {
                eyebrow: 'For our smaller guests',
                title: 'Kids menu',
                items: '# Mains\nFish fingers, chips & peas\nTomato pasta, cheese & basil\nChicken strips, corn & dip\n# Treats\nIce cream sundae\nChocolate brownie\nFruit salad',
                activity: 'Colour in the rocket, then find the star. Ask the team for a crayon!',
                foot: 'Allergens available on request · www.thephysician.bar',
            },
            draw(W, H) {
                const portrait = H > W;
                const p = W * 0.07;
                R(0, 0, W, H, 'paper');
                R(0, 0, W, H * 0.01, 'accent');
                if (portrait) {
                    logoAt(p, H * 0.045, H * 0.06, 'ink', 'l', 0.5);
                    put(T('eyebrow').toUpperCase(), p, H * 0.115, fnt('l', 700, 16 * U), 2.4 * U, 'l', C('accent'));
                    stack([p, H * 0.14, W - 2 * p, H * 0.08], [{ k: 'title', z: 58 }], { al: 'l', va: 't' });
                    menuList([p, H * 0.24, W - 2 * p, H * 0.42], { zn: 30, zd: 20, zp: 28, g: 38, zh: 17, al: 'c' });
                    X.setLineDash([8 * U, 8 * U]);
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(2, 3 * U);
                    X.strokeRect(p, H * 0.69, W - 2 * p, H * 0.22);
                    X.setLineDash([]);
                    put('Activity', p + 14 * U, H * 0.725, fnt('l', 700, 14 * U), 2 * U, 'l', C('accent'));
                    stack([p + 14 * U, H * 0.75, W - 2 * p - 28 * U, H * 0.08], [{ k: 'activity', z: 18, f: 'b' }], { al: 'l', va: 't' });
                    const rowWidth = W - 2 * p - 56 * U;
                    [0, 1, 2, 3, 4].forEach((index) => {
                        drawMotif(index % 2 ? 'star' : 'sprig', p + 28 * U + (index + 0.5) * rowWidth / 5, H * 0.865, 42 * U, C('accent'), C('mute'));
                    });
                } else {
                    const menuW = W * 0.5;
                    logoAt(p, H * 0.1, H * 0.065, 'ink', 'l', 0.4);
                    put(T('eyebrow').toUpperCase(), p, H * 0.2, fnt('l', 700, 16 * U), 2.4 * U, 'l', C('accent'));
                    stack([p, H * 0.23, menuW, H * 0.1], [{ k: 'title', z: 58 }], { al: 'l', va: 't' });
                    menuList([p, H * 0.37, menuW, H * 0.5], { zn: 26, zd: 17, zp: 25, g: 32, zh: 16 });
                    const boxX = W * 0.61;
                    const onAccent = colorLuma(C('accent')) > 0.33 ? C('ink') : C('paper');
                    R(boxX, H * 0.1, W - boxX - p, H * 0.8, 'accent');
                    drawMotif('star', boxX + (W - boxX - p) / 2, H * 0.2, Math.min(W, H) * 0.13, onAccent, onAccent);
                    stack([boxX + 18 * U, H * 0.33, W - boxX - p - 36 * U, H * 0.3], [
                        { s: 'Activity', z: 26, f: 'l', c: onAccent, up: 1, ls: .24, g: 16 },
                        { k: 'activity', z: 17, f: 'b', c: onAccent, g: 0 },
                    ], { al: 'l', va: 't' });
                    const innerX = boxX + 20 * U;
                    const innerW = W - boxX - p - 40 * U;
                    [0, 1, 2, 3, 4].forEach((index) => {
                        drawMotif(index % 2 ? 'star' : 'leaf', innerX + (index + 0.5) * innerW / 5, H * 0.76, 46 * U, onAccent, onAccent);
                    });
                    put(T('foot'), p, H * 0.92, fnt('b', 400, 14 * U), 0, 'l', C('mute'));
                }
            },
        },
        {
            n: 'Takeaway / delivery menu', sizes: ['A5 portrait', 'Slim DL'], q: 1,
            hint: 'One item per line: Name | Description | Price. Start a section with #.',
            t: {
                eyebrow: 'Takeaway & delivery',
                title: 'Order in',
                items: '# From the kitchen\nFish & chips | £14\nBurger, cheese & pickles | £13\nMac & cheese | £10\n# Sides\nFries | £4\nHouse salad | £4',
                order: 'Order at the bar or scan the code.',
                delivery: 'Delivery 5–9pm · £3 within 3 miles',
                foot: 'www.thephysician.bar',
            },
            draw(W, H) {
                const p = W * 0.08;
                R(0, 0, W, H, 'paper');
                R(0, 0, W, H * 0.012, 'accent');
                logoAt(p, H * 0.05, W * 0.07, 'ink', 'l', 0.5);
                put(T('eyebrow').toUpperCase(), p, H * 0.115, fnt('l', 700, 16 * U), 2.4 * U, 'l', C('accent'));
                stack([p, H * 0.135, W - 2 * p, H * 0.1], [{ k: 'title', z: 66 }], { al: 'l', va: 't' });
                menuList([p, H * 0.26, W - 2 * p, H * 0.45], { zn: 29, zd: 19, zp: 27, g: 38, zh: 17 });
                const qrSize = W * 0.3;
                qrAt(p, H * 0.75, qrSize, 1);
                stack([p + qrSize + 14 * U, H * 0.76, W - 2 * p - qrSize - 14 * U, H * 0.14], [
                    { k: 'order', z: 20, f: 'b', g: 10 },
                    { k: 'delivery', z: 16, f: 'b', c: 'mute' },
                ], { al: 'l', va: 't' });
                put(T('foot'), p, H * 0.94, fnt('b', 400, 15 * U), 0, 'l', C('mute'));
            },
        },
    );
})();

(function () {
    const SIZES = [
        { n: 'Card (front & back)', d: 'Print · 85×55 mm · two sides', w: 1004, h: 1340, mm: [85, 55], dpi: 300, sides: 2 },
        { n: 'Card', d: 'Print · 85×55 mm', w: 1004, h: 650, mm: [85, 55], dpi: 300 },
        { n: 'A6 portrait', d: 'Print · 105×148 mm', w: 620, h: 874, mm: [105, 148], dpi: 150 },
        { n: 'Door hanger', d: 'Print · 90×210 mm · die-cut', w: 531, h: 1240, mm: [90, 210], dpi: 150, sides: 2, shape: 'hanger' },
    ];
    window.AssetCategories.guest = {
        id: 'guest',
        title: 'Guest & Hotel Card Maker',
        sub: 'Loyalty, reviews, door hangers and welcome cards.',
        sizes: SIZES,
        fields: [],
        tpls: [
            {
                n: 'Loyalty stamp card', sizes: ['Card (front & back)'],
                hint: 'Stamps takes 6, 8 or 10. The back carries the terms and handle.',
                t: {
                    title: 'Loyalty card',
                    reward: 'Ten stamps = a drink on us',
                    stamps: '8',
                    terms: 'One stamp per visit. Not transferable. Valid for 12 months.',
                    foot: 'www.thephysician.bar',
                },
                draw(W, H, side) {
                    const p = W * 0.08;
                    if (side === 'b') {
                        R(0, 0, W, H, 'paper');
                        R(0, 0, W, H * 0.03, 'accent');
                        logoAt(p, H * 0.1, H * 0.12, 'ink', 'l', 0.45);
                        stack([p, H * 0.27, W - 2 * p, H * 0.42], [
                            { k: 'terms', z: 20, f: 'b', c: 'mute', g: 22 },
                            { k: 'foot', z: 16, f: 'l', g: 10 },
                        ], { al: 'l', va: 't' });
                        drawMotif('star', W - p - 18 * U, H * 0.16, 42 * U, C('accent'), C('accent'));
                        return;
                    }
                    R(0, 0, W, H, 'paper');
                    R(0, 0, W, H * 0.03, 'accent');
                    logoAt(p, H * 0.095, H * 0.11, 'ink', 'l', 0.45);
                    put(T('title').toUpperCase(), p, H * 0.215, fnt('l', 700, 12 * U), 2.4 * U, 'l', C('accent'));
                    stampGrid([p, H * 0.26, W - 2 * p, H * 0.4], { count: 8, motif: 'star' });
                    stack([p, H * 0.73, W - 2 * p, H * 0.16], [
                        { k: 'reward', z: 23, f: 'd', g: 14 },
                        { k: 'foot', z: 13, f: 'l', c: 'mute' },
                    ], { al: 'l', va: 't' });
                },
            },
            {
                n: 'Review-us card', sizes: ['Card', 'A6 portrait'], q: 1,
                t: {
                    title: 'Loved your visit?',
                    message: 'Scan the code to leave us a review. It takes a minute and means a lot.',
                    cta: 'Google · TripAdvisor',
                    foot: 'Thank you from all of us at the venue.',
                },
                draw(W, H) {
                    const p = W * 0.08;
                    const wide = W / H > 1.6;
                    R(0, 0, W, H, 'paper');
                    R(0, 0, W * 0.02, H, 'accent');
                    logoAt(p, H * 0.08, Math.min(W, H) * 0.14, 'ink', 'l', 0.45);
                    if (wide) {
                        const qrSize = H * 0.56;
                        stack([p, H * 0.28, W - 2 * p - qrSize - 18 * U, H * 0.6], [
                            { k: 'title', z: 40, g: 14 },
                            { k: 'message', z: 18, f: 'b', c: 'mute', g: 10 },
                            { k: 'cta', z: 16, f: 'l', up: 1, ls: .16, c: 'accent' },
                        ], { al: 'l', va: 't' });
                        qrAt(W - p - qrSize, (H - qrSize) / 2, qrSize, 1);
                    } else {
                        const qrSize = Math.min(W * 0.5, H * 0.32);
                        put(T('title'), W / 2, H * 0.24, fnt('d', 600, 34 * U), 0, 'c', C('ink'));
                        qrAt((W - qrSize) / 2, H * 0.34, qrSize, 1);
                        stack([p, H * 0.7, W - 2 * p, H * 0.18], [
                            { k: 'message', z: 17, f: 'b', c: 'mute', g: 10 },
                            { k: 'cta', z: 14, f: 'l', up: 1, ls: .14, c: 'accent' },
                        ], { al: 'c', va: 't' });
                    }
                    put(T('foot'), W / 2, H * 0.95, fnt('b', 400, 12 * U), 0, 'c', C('mute'));
                },
            },
            {
                n: 'Door hanger', sizes: ['Door hanger'],
                t: {
                    title: 'Do not disturb',
                    message: 'We are resting. Please leave us be until morning.',
                    altTitle: 'Service, please',
                    altMessage: 'We are out. Please refresh the room while we are away.',
                    foot: 'Reception · dial 0',
                },
                draw(W, H, side) {
                    const p = W * 0.12;
                    const back = side === 'b';
                    R(0, 0, W, H, back ? 'accent' : 'paper');
                    const ink = back ? accentTextColor() : C('ink');
                    logoAt(W / 2, H * 0.25, W * 0.16, back ? ink : C('ink'), 'c', 0.6);
                    put((back ? T('altTitle') : T('title')).toUpperCase(), W / 2, H * 0.47, fnt('d', 700, 36 * U), 0, 'c', ink);
                    stack([p, H * 0.53, W - 2 * p, H * 0.2], [
                        { s: back ? T('altMessage') : T('message'), z: 22, f: 'b', g: 0, c: back ? ink : C('mute') },
                    ], { al: 'c', va: 't' });
                    drawMotif(back ? 'star' : 'sprig', W / 2, H * 0.8, Math.min(W, H) * 0.16, ink, ink);
                    put(T('foot'), W / 2, H * 0.94, fnt('b', 400, 15 * U), 0, 'c', back ? ink : C('mute'));
                },
            },
            {
                n: 'Welcome & Wi-Fi card', sizes: ['A6 portrait'], q: 1,
                t: {
                    title: 'Welcome',
                    message: 'We are delighted to have you. Reception is open 7am–11pm.',
                    network: 'ThePhysician_Guest',
                    password: 'welcome2026',
                    breakfast: 'Breakfast · 7.30–10am, The Garden Room',
                    reception: 'Reception · dial 0 from your room',
                    foot: 'www.thephysician.bar',
                },
                draw(W, H) {
                    const p = W * 0.09;
                    R(0, 0, W, H, 'paper');
                    R(0, 0, W, H * 0.02, 'accent');
                    logoAt(p, H * 0.06, W * 0.1, 'ink', 'l', 0.5);
                    put(T('title'), p, H * 0.2, fnt('d', 600, 46 * U), 0, 'l', C('ink'));
                    stack([p, H * 0.25, W - 2 * p, H * 0.1], [{ k: 'message', z: 17, f: 'b', c: 'mute' }], { al: 'l', va: 't' });
                    R(p, H * 0.38, W - 2 * p, H * 0.02, 'accent');
                    put('WI-FI', p, H * 0.44, fnt('l', 700, 13 * U), 2.4 * U, 'l', C('accent'));
                    put(T('network'), p, H * 0.49, fnt('d', 600, 26 * U), 0, 'l', C('ink'));
                    put(`Password ${T('password')}`, p, H * 0.54, fnt('b', 400, 18 * U), 0, 'l', C('mute'));
                    const qrSize = W * 0.28;
                    qrAt(W - p - qrSize, H * 0.44, qrSize, 1);
                    put(T('breakfast'), p, H * 0.67, fnt('b', 400, 17 * U), 0, 'l', C('ink'));
                    put(T('reception'), p, H * 0.72, fnt('b', 400, 17 * U), 0, 'l', C('ink'));
                    put(T('foot'), p, H * 0.9, fnt('b', 400, 14 * U), 0, 'l', C('mute'));
                },
            },
        ],
    };
})();

(function () {
    window.AssetCategories.stationery = {
        id: 'stationery',
        title: 'Stationery Maker',
        sub: 'Letterheads and thank-you cards that carry the identity.',
        sizes: [
            { n: 'A4 portrait', d: 'Print · 210×297 mm', w: 1240, h: 1754, mm: [210, 297], dpi: 150 },
            { n: 'DL landscape', d: 'Print · 210×99 mm', w: 1240, h: 585, mm: [210, 99], dpi: 150 },
            { n: 'A6 landscape', d: 'Print · 148×105 mm', w: 874, h: 620, mm: [148, 105], dpi: 150 },
        ],
        fields: [],
        tpls: [
            {
                n: 'Letterhead', sizes: ['A4 portrait'],
                t: {
                    brandLine: 'Scottish produce, warm welcome',
                    address: '129 South Street, St Andrews, KY16 9UH',
                    phone: '01334 479191',
                    email: 'reservations@theadamson.com',
                    web: 'www.thephysician.bar',
                    foot: 'Registered in Scotland · Company no. SC000000',
                },
                draw(W, H) {
                    const p = W * 0.11;
                    R(0, 0, W, H, 'paper');
                    logoAt(p, H * 0.055, W * 0.045, 'ink', 'l', 0.42);
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(1, 1.5 * U);
                    X.beginPath();
                    X.moveTo(p, H * 0.11);
                    X.lineTo(W - p, H * 0.11);
                    X.stroke();
                    put(T('brandLine').toUpperCase(), p, H * 0.135, fnt('l', 700, 11 * U), 2.2 * U, 'l', C('accent'));
                    X.textAlign = 'right';
                    [T('address'), T('phone'), T('email'), T('web')].forEach((line, index) => {
                        put(line, W - p, H * 0.16 + index * 15 * U, fnt('b', 400, 11 * U), 0, 'r', C('mute'));
                    });
                    X.strokeStyle = mix(C('paper'), C('ink'), 0.25);
                    X.lineWidth = Math.max(1, 1 * U);
                    X.beginPath();
                    X.moveTo(p, H * 0.9);
                    X.lineTo(W - p, H * 0.9);
                    X.stroke();
                    put(T('foot'), p, H * 0.94, fnt('b', 400, 10 * U), 0, 'l', C('mute'));
                    drawMotif('sprig', W - p - 24 * U, H * 0.94, 30 * U, C('mute'), C('accent'));
                },
            },
            {
                n: 'Thank-you / compliment card', sizes: ['DL landscape', 'A6 landscape'],
                t: {
                    eyebrow: 'Thank you',
                    title: 'A note of thanks',
                    message: 'Thank you for spending time with us. It was a pleasure to look after you, and we hope to see you again soon.',
                    foot: 'www.thephysician.bar · 129 South Street, St Andrews',
                },
                draw(W, H) {
                    const p = W * 0.08;
                    R(0, 0, W, H, 'paper');
                    R(0, 0, W, H * 0.02, 'accent');
                    logoAt(W / 2, H * 0.14, Math.min(W, H) * 0.16, 'ink', 'c', 0.5);
                    put(T('eyebrow').toUpperCase(), W / 2, H * 0.3, fnt('l', 700, 14 * U), 3 * U, 'c', C('accent'));
                    stack([p, H * 0.36, W - 2 * p, H * 0.2], [{ k: 'title', z: 40 }], { al: 'c', va: 't' });
                    stack([W * 0.16, H * 0.54, W * 0.68, H * 0.26], [{ k: 'message', z: 17, f: 'b', c: 'mute' }], { al: 'c', va: 't' });
                    put(T('foot'), W / 2, H * 0.9, fnt('b', 400, 13 * U), 0, 'c', C('mute'));
                    drawMotif('star', W - p - 20 * U, H * 0.09, 26 * U, C('accent'), C('accent'));
                },
            },
        ],
    };
})();

(function () {
    window.AssetCategories.packaging = {
        id: 'packaging',
        title: 'Packaging & Merch Maker',
        sub: 'Stickers, coasters, sleeves and envelopes on a die-line.',
        sizes: [
            { n: 'Circle 50 mm', d: 'Die-cut · 50 mm', w: 591, h: 591, mm: [50, 50], dpi: 300, shape: 'circle' },
            { n: 'Circle 70 mm', d: 'Die-cut · 70 mm', w: 827, h: 827, mm: [70, 70], dpi: 300, shape: 'circle' },
            { n: 'Round 90 mm', d: 'Die-cut · 90 mm', w: 1063, h: 1063, mm: [90, 90], dpi: 300, shape: 'circle' },
            { n: 'Square 95 mm', d: 'Die-cut · 95 mm', w: 1122, h: 1122, mm: [95, 95], dpi: 300, shape: 'rounded' },
            { n: 'Sleeve 230×90', d: 'Die-cut · 230×90 mm', w: 2717, h: 1063, mm: [230, 90], dpi: 300, shape: 'rounded' },
            { n: 'DL envelope', d: 'Print · 220×110 mm', w: 1299, h: 650, mm: [220, 110], dpi: 150, shape: 'rounded' },
            { n: 'C6 envelope', d: 'Print · 162×114 mm', w: 957, h: 673, mm: [162, 114], dpi: 150, shape: 'rounded' },
        ],
        fields: [],
        tpls: [
            {
                n: 'Round sticker / bag seal', sizes: ['Circle 50 mm', 'Circle 70 mm'],
                t: {
                    title: 'Freshly made',
                    sub: 'Baked this morning',
                    foot: 'okja · bakery & café',
                },
                draw(W, H) {
                    const cx = W / 2;
                    const cy = H / 2;
                    const r = Math.min(W, H) / 2;
                    R(0, 0, W, H, 'ink');
                    const on = C('paper');
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(1.5, r * 0.02);
                    X.beginPath();
                    X.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
                    X.stroke();
                    put(T('title').toUpperCase(), cx, cy - r * 0.18, fnt('d', 700, r * 0.15), r * 0.012, 'c', on);
                    put(T('sub'), cx, cy + r * 0.04, fnt('b', 400, r * 0.08), 0, 'c', on);
                    drawMotif('sprig', cx, cy + r * 0.38, r * 0.34, on, C('accent'));
                    put(T('foot'), cx, cy + r * 0.72, fnt('l', 700, r * 0.045), r * 0.008, 'c', on);
                },
            },
            {
                n: 'Coaster', sizes: ['Round 90 mm', 'Square 95 mm'],
                t: {
                    title: 'The Physician',
                    tagline: 'Find your cure.',
                    foot: '129 South Street · St Andrews',
                },
                draw(W, H) {
                    const cx = W / 2;
                    const cy = H / 2;
                    const r = Math.min(W, H) / 2;
                    R(0, 0, W, H, 'paper');
                    X.strokeStyle = C('accent');
                    X.lineWidth = Math.max(2, r * 0.012);
                    X.beginPath();
                    X.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
                    X.stroke();
                    logoAt(cx, cy - r * 0.34, r * 0.26, 'ink', 'c');
                    drawMotif('rod', cx, cy + r * 0.02, r * 0.34, C('accent'), C('ink'));
                    put(T('tagline'), cx, cy + r * 0.42, fnt('d', 400, r * 0.11), 0, 'c', C('ink'));
                    put(T('foot'), cx, cy + r * 0.62, fnt('l', 700, r * 0.045), r * 0.008, 'c', C('mute'));
                },
            },
            {
                n: 'Cup / bottle sleeve', sizes: ['Sleeve 230×90'],
                t: {
                    title: 'Okja',
                    sub: 'Coffee & bakery',
                    foot: 'okja · Glasgow',
                },
                draw(W, H) {
                    R(0, 0, W, H, 'accent');
                    const on = accentTextColor();
                    const panel = W / 3;
                    for (let index = 0; index < 3; index += 1) {
                        X.strokeStyle = rgba(on, 0.35);
                        X.lineWidth = Math.max(1, W * 0.001);
                        X.beginPath();
                        X.moveTo(panel * index, H * 0.12);
                        X.lineTo(panel * index, H * 0.88);
                        X.stroke();
                        drawMotif(index === 1 ? 'arch' : 'sprig', panel * (index + 0.5), H * 0.86, H * 0.16, on, on);
                    }
                    put(T('title'), panel * 0.5, H * 0.28, fnt('d', 700, H * 0.15), 0, 'c', on);
                    put(T('sub').toUpperCase(), panel * 0.5, H * 0.42, fnt('l', 700, H * 0.05), H * 0.012, 'c', on);
                    put(T('title'), panel * 1.5, H * 0.34, fnt('d', 700, H * 0.22), 0, 'c', on);
                    put('CAFÉ', panel * 1.5, H * 0.48, fnt('l', 700, H * 0.05), H * 0.02, 'c', on);
                    put(T('foot'), panel * 2.5, H * 0.34, fnt('b', 400, H * 0.06), 0, 'c', on);
                    put('OPEN DAILY', panel * 2.5, H * 0.46, fnt('l', 700, H * 0.045), H * 0.012, 'c', on);
                },
            },
            {
                n: 'Voucher envelope', sizes: ['DL envelope', 'C6 envelope'],
                t: {
                    eyebrow: 'A gift for you',
                    title: 'The Physician',
                    message: 'Dinner, drinks and a warm welcome.',
                    foot: 'www.thephysician.bar',
                },
                draw(W, H) {
                    const p = W * 0.07;
                    R(0, 0, W, H, 'paper');
                    X.strokeStyle = rgba(C('ink'), 0.25);
                    X.lineWidth = Math.max(1, W * 0.0012);
                    X.beginPath();
                    X.moveTo(p, H * 0.1);
                    X.lineTo(W / 2, H * 0.34);
                    X.lineTo(W - p, H * 0.1);
                    X.stroke();
                    logoAt(p, H * 0.3, Math.min(W, H) * 0.1, 'ink', 'l', 0.45);
                    stack([p, H * 0.48, W * 0.56, H * 0.26], [
                        { k: 'eyebrow', z: 12, f: 'l', up: 1, ls: .24, c: 'accent', g: 10 },
                        { k: 'message', z: 17, f: 'b', c: 'mute' },
                    ], { al: 'l', va: 't' });
                    const qrSize = H * 0.32;
                    qrAt(W - p - qrSize, H * 0.42, qrSize, 1);
                    put(T('title'), p, H * 0.87, fnt('d', 600, 18 * U), 0, 'l', C('ink'));
                    put(T('foot'), W - p, H * 0.87, fnt('b', 400, 12 * U), 0, 'r', C('mute'));
                    R(0, H * 0.97, W, H * 0.03, 'accent');
                },
            },
        ],
    };
})();

(function () {
    const cfg = window.AssetCategories.social;
    if (!cfg) return;
    cfg.sizes.push(
        { n: 'Link image', d: 'Open Graph · 1200×630', w: 1200, h: 630, print: false },
        { n: 'Facebook event cover', d: 'Screen · 1920×1005', w: 1920, h: 1005, print: false },
        { n: 'Facebook event cover (minimum)', d: 'Screen · 1200×628', w: 1200, h: 628, print: false },
        { n: 'Facebook page cover', d: 'Screen · 820×312', w: 820, h: 312, print: false },
        { n: 'LinkedIn personal banner', d: 'Screen · 1584×396', w: 1584, h: 396, print: false },
        { n: 'LinkedIn company cover', d: 'Screen · 1128×191', w: 1128, h: 191, print: false },
        { n: 'Email header', d: 'Screen · 1200×400', w: 1200, h: 400, print: false },
    );
    ['Statement', "Chef's special", 'Sunday sessions', 'Christmas icon', 'Announcement'].forEach((name) => {
        const tpl = cfg.tpls.find((item) => item.n === name);
        if (tpl) tpl.sizes = ['Square', 'Portrait 4:5', 'Story 9:16'];
    });
    cfg.tpls.push(
        {
            n: 'Carousel set', sizes: ['Portrait 4:5', 'Square'], multi: true, profile: 'screen', q: 1,
            hint: 'One point per line. The cover and the CTA slide are added automatically (3–10 slides).',
            t: {
                eyebrow: 'A little story',
                title: 'Five things to know',
                sub: 'Swipe through',
                points: 'We source from growers within 30 miles.\nThe menu changes with the seasons.\nEverything is made in-house.\nDogs are welcome in the bar.',
                body: 'A short supporting line that sits under each point.',
                cta: 'Book your table',
                foot: 'www.thephysician.bar',
            },
            draw(W, H) {
                const p = W * 0.09;
                const points = String(T('points') || '').split('\n').map((line) => line.trim()).filter(Boolean);
                const total = Math.max(3, Math.min(10, 2 + points.length));
                const slide = Math.max(0, Math.min(total - 1, Number(S?.slideIndex) || 0));
                const isCover = slide === 0;
                const isCta = slide === total - 1;
                const point = points[slide - 1] || '';
                R(0, 0, W, H, isCta ? 'accent' : 'paper');
                const ink = isCta ? accentTextColor() : C('ink');
                R(0, 0, W, H * 0.012, isCta ? accentTextColor() : C('accent'));
                logoAt(p, H * 0.06, W * 0.055, ink, 'l');
                if (isCover) {
                    put(T('eyebrow').toUpperCase(), p, H * 0.2, fnt('l', 700, 16 * U), 3 * U, 'l', isCta ? ink : C('accent'));
                    stack([p, H * 0.25, W - 2 * p, H * 0.36], [{ k: 'title', z: 96, c: ink, lh: 1.03 }], { al: 'l', va: 't' });
                    stack([p, H * 0.65, W - 2 * p, H * 0.1], [{ k: 'sub', z: 26, f: 'b', c: ink }], { al: 'l', va: 't' });
                    drawMotif('star', W - p - 40 * U, H * 0.72, 64 * U, C('accent'), C('accent'));
                } else if (isCta) {
                    put('LAST SLIDE', p, H * 0.2, fnt('l', 700, 15 * U), 3 * U, 'l', ink);
                    stack([p, H * 0.24, W - 2 * p, H * 0.3], [{ k: 'cta', z: 84, c: ink, lh: 1.05 }], { al: 'l', va: 't' });
                    stack([p, H * 0.58, W - 2 * p, H * 0.12], [{ k: 'foot', z: 24, f: 'b', c: ink }], { al: 'l', va: 't' });
                    qrAt(W - p - W * 0.2, H * 0.72, W * 0.2, 1);
                } else {
                    put(`0${slide + 1} / 0${total}`, p, H * 0.19, fnt('l', 700, 15 * U), 3 * U, 'l', C('accent'));
                    stack([p, H * 0.24, W - 2 * p, H * 0.3], [{ s: point, z: 78, c: ink, lh: 1.1 }], { al: 'l', va: 't' });
                    R(p, H * 0.55, W * 0.12, H * 0.004, isCta ? ink : C('accent'));
                    stack([p, H * 0.58, W - 2 * p, H * 0.12], [{ k: 'body', z: 22, f: 'b', c: C('mute') }], { al: 'l', va: 't' });
                    drawMotif('sprig', W - p - 30 * U, H * 0.72, 70 * U, C('accent'), C('accent'));
                }
                if (!isCta) {
                    put(`Swipe  →`, W - p, H * 0.92, fnt('l', 700, 14 * U), 2 * U, 'r', isCta ? ink : C('accent'));
                }
                for (let index = 0; index < total; index += 1) {
                    X.fillStyle = index === slide ? (isCta ? ink : C('accent')) : rgba(isCta ? ink : C('accent'), 0.28);
                    X.beginPath();
                    X.arc(p + index * 14 * U, H * 0.955, 3.2 * U, 0, Math.PI * 2);
                    X.fill();
                }
            },
        },
        {
            n: 'Link-share image', sizes: ['Link image'], profile: 'screen',
            t: {
                eyebrow: 'From the kitchen',
                title: 'The Sunday roast is back.',
                sub: 'Every Sunday from 12, while it lasts.',
                cta: 'Book at www.thephysician.bar',
                foot: 'www.thephysician.bar',
            },
            draw(W, H) {
                const p = W * 0.07;
                R(0, 0, W, H, 'paper');
                R(W * 0.62, 0, W * 0.38, H, 'accent');
                logoAt(p, H * 0.12, W * 0.05, 'ink', 'l');
                stack([p, H * 0.3, W * 0.5, H * 0.36], [{ k: 'title', z: 72, lh: 1.05 }], { al: 'l', va: 't' });
                stack([p, H * 0.68, W * 0.5, H * 0.12], [
                    { k: 'sub', z: 22, f: 'b', c: 'mute', g: 14 },
                    { k: 'cta', z: 18, f: 'l', up: 1, ls: .16, c: 'accent' },
                ], { al: 'l', va: 't' });
                drawMotif('sprig', W * 0.81, H * 0.42, H * 0.42, accentTextColor(), accentTextColor());
                put(T('eyebrow').toUpperCase(), W * 0.81, H * 0.16, fnt('l', 700, 14 * U), 2.4 * U, 'c', accentTextColor());
            },
        },
        {
            n: 'Cover banner', sizes: ['Facebook event cover', 'Facebook event cover (minimum)', 'Facebook page cover', 'LinkedIn personal banner', 'LinkedIn company cover'], profile: 'screen',
            t: {
                eyebrow: 'Live music · Saturday 14 November',
                title: 'Saturday sessions',
                sub: 'The Late Set, from 8pm. Free entry.',
                cta: 'Book a table',
                foot: 'www.thephysician.bar',
            },
            draw(W, H) {
                const ratio = W / H;
                const compact = ratio > 4.4;
                const shallow = ratio > 2.6;
                R(0, 0, W, H, 'ink');
                const on = C('paper');
                const cx = W / 2;
                if (compact) {
                    logoAt(W * 0.02, H * 0.5, H * 0.18, 'paper', 'l', 0.22);
                    stack([W * 0.27, H * 0.2, W * 0.42, H * 0.6], [
                        { k: 'title', z: 40, c: on, lh: 1.02 },
                    ], { al: 'c', va: 'm' });
                    const note = T('eyebrow').toUpperCase();
                    const avail = W * 0.27;
                    let noteSize = H * 0.1;
                    let noteFont = fnt('l', 700, noteSize);
                    while (noteSize > 8 && tw(note, noteFont, noteSize * 0.14) > avail) {
                        noteSize *= 0.9;
                        noteFont = fnt('l', 700, noteSize);
                    }
                    put(note, W - W * 0.02, H * 0.5, noteFont, noteSize * 0.14, 'r', C('accent'));
                    return;
                }
                logoAt(cx, H * (shallow ? 0.12 : 0.115), H * (shallow ? 0.2 : 0.13), 'paper', 'c', 0.5);
                put(T('eyebrow').toUpperCase(), cx, H * 0.32, fnt('l', 700, Math.max(10 * U, H * 0.045)), Math.max(1.5 * U, H * 0.008), 'c', C('accent'));
                stack([W * 0.12, H * 0.36, W * 0.76, H * (shallow ? 0.3 : 0.28)], [
                    { k: 'title', z: 66, c: on, lh: 1.04 },
                ], { al: 'c', va: 't' });
                stack([W * 0.18, H * (shallow ? 0.68 : 0.66), W * 0.64, H * 0.14], [
                    { k: 'sub', z: 22, c: on, f: 'b' },
                ], { al: 'c', va: 't' });
                R(cx - W * 0.05, H * 0.86, W * 0.1, H * 0.006, 'accent');
            },
        },
        {
            n: 'Email header', sizes: ['Email header'], profile: 'screen',
            t: {
                eyebrow: 'Newsletter · November',
                title: 'What is new this month',
                sub: 'Events, menus and the odd secret.',
                foot: 'www.thephysician.bar',
            },
            draw(W, H) {
                const p = W * 0.05;
                R(0, 0, W, H, 'paper');
                R(0, H * 0.92, W, H * 0.08, 'accent');
                logoAt(p, H * 0.5, H * 0.22, 'ink', 'l');
                stack([W * 0.42, H * 0.2, W * 0.52, H * 0.42], [
                    { k: 'eyebrow', z: 13, f: 'l', up: 1, ls: .26, c: 'accent', g: 12 },
                    { k: 'title', z: 44, g: 10 },
                ], { al: 'l', va: 't' });
                put(T('sub'), W * 0.42, H * 0.72, fnt('b', 400, 15 * U), 0, 'l', C('mute'));
                put(T('foot'), W - p, H * 0.96, fnt('l', 700, 12 * U), 2 * U, 'r', accentTextColor());
            },
        },
    );
})();

(function () {
    window.AssetCategories.compliance = {
        id: 'compliance',
        title: 'Compliance Maker',
        sub: 'Allergen matrices and prep labels for the kitchen.',
        sizes: [
            { n: 'A4 landscape', d: 'Print · 297×210 mm', w: 1754, h: 1240, mm: [297, 210], dpi: 150 },
            { n: 'Label 50×30', d: 'Thermal · 50×30 mm', w: 591, h: 354, mm: [50, 30], dpi: 300 },
            { n: 'Label 76×51', d: 'Thermal · 76×51 mm', w: 898, h: 602, mm: [76, 51], dpi: 300 },
        ],
        fields: [],
        tpls: [
            {
                n: 'Allergen matrix', sizes: ['A4 landscape'],
                hint: 'One dish per line: Dish | allergen, allergen. Names, 3-letter codes (Mil, Sul) or numbers 1–14.',
                t: {
                    title: 'Allergen matrix',
                    sub: 'All dishes, all 14 allergens. Ask the team if you need more detail.',
                    items: 'Oysters, shallot vinegar | Molluscs\nCured salmon, dill oil | Fish\nDry-aged beef, bone marrow | Milk, Sulphites\nWild mushroom tart | Gluten, Milk, Egg\nNegroni | Sulphites\nChocolate orange tart | Gluten, Milk, Egg, Nuts\nFries | Sulphites',
                    updated: 'Updated 31 October 2026',
                    foot: 'The Physician · 129 South Street, St Andrews',
                },
                draw(W, H) {
                    const p = W * 0.05;
                    R(0, 0, W, H, 'paper');
                    logoAt(p, H * 0.05, W * 0.032, 'ink', 'l', 0.35);
                    stack([p, H * 0.14, W * 0.56, H * 0.13], [
                        { k: 'title', z: 52, g: 6 },
                        { k: 'sub', z: 15, f: 'b', c: 'mute' },
                    ], { al: 'l', va: 't' });
                    allergenMatrix([p, H * 0.29, W - 2 * p, H * 0.66], { labelWidth: 0.33 });
                    put(T('foot'), p, H * 0.965, fnt('b', 400, 12 * U), 0, 'l', C('mute'));
                },
            },
            {
                n: 'Prep / day-dot label', sizes: ['Label 50×30', 'Label 76×51'], profile: 'thermal',
                t: {
                    item: 'Roast chicken',
                    prep: 'PREP 31/10',
                    useby: 'USE BY 02/11',
                    initials: 'LD',
                    allergens: 'Contains: milk, sulphites',
                    storage: 'Keep refrigerated 0–4°C',
                },
                draw(W, H) {
                    const p = W * 0.045;
                    const ink = '#111111';
                    R(0, 0, W, H, '#ffffff');
                    X.strokeStyle = ink;
                    X.lineWidth = Math.max(1.5, H * 0.008);
                    X.strokeRect(0, 0, W, H);
                    put(T('item'), p, H * 0.16, fnt('b', 700, H * 0.16), 0, 'l', ink);
                    X.beginPath();
                    X.moveTo(p, H * 0.28);
                    X.lineTo(W - p, H * 0.28);
                    X.stroke();
                    const initialsW = H * 0.2;
                    const gap = H * 0.025;
                    const boxW = (W - 2 * p - initialsW - gap * 2) / 2;
                    X.lineWidth = Math.max(1, H * 0.005);
                    [T('prep'), T('useby')].forEach((line, index) => {
                        const left = p + index * (boxW + gap);
                        X.strokeRect(left, H * 0.34, boxW, H * 0.2);
                        put('PREP / USE BY', left + H * 0.018, H * 0.385, fnt('l', 700, H * 0.04), 0, 'l', ink);
                        put(line, left + H * 0.018, H * 0.465, fnt('l', 700, H * 0.075), 0, 'l', ink);
                    });
                    const initialsX = W - p - initialsW;
                    X.strokeRect(initialsX, H * 0.34, initialsW, H * 0.2);
                    put('INITIALS', initialsX + H * 0.018, H * 0.385, fnt('l', 700, H * 0.04), 0, 'l', ink);
                    put(T('initials'), initialsX + initialsW / 2, H * 0.465, fnt('l', 700, H * 0.09), 0, 'c', ink);
                    put(T('allergens'), p, H * 0.64, fnt('b', 700, H * 0.065), 0, 'l', ink);
                    put(T('storage'), p, H * 0.76, fnt('b', 400, H * 0.06), 0, 'l', ink);
                    put(new Date().toLocaleDateString('en-GB'), W - p, H * 0.76, fnt('b', 400, H * 0.055), 0, 'r', ink);
                },
            },
        ],
    };
})();
