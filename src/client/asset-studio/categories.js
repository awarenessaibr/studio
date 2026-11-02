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
draw(W,H){const m=W*.04,ph=H*.58;photo(m,m,W-2*m,ph-m);stack([W*.05,ph+H*.025,W*.9,H-ph-H*.05],[{k:'title',z:82,up:1,ls:.01,lh:1.05},{k:'date',z:32,f:'l',up:1,ls:.28,g:34},{k:'price',z:42,f:'l',w:700,up:1,g:30},{k:'body',z:21,f:'l',w:600,up:1,ls:.1,g:36}])}},
{n:'Christmas · type',t:{eyebrow:'Decadance Daytime Clubbing',title:'Christmas Brunch',date:'Sunday 13th December',price:'2 courses + cocktail £49',body:'Decadance DJs, Singalongs, Confetti, Glowsticks & More\nWith DJs Vanessa Motion & Chris Jordan',foot:'the adamson | THE PHYSICIAN'},
draw(W,H){const p=W*.09,w=W-2*p;stack([p,H*.05,w,H*.05],[{k:'eyebrow',z:24,f:'l',up:1,ls:.32}],{va:'t'});
stack([p,H*.14,w,H*.56],[{k:'title',z:126,up:1,lh:1.02},{bar:1,h:7,c:'accent',g:44},{k:'date',z:48,f:'l',up:1,ls:.1,g:40},{k:'price',z:46,up:1,w:700,g:18}]);
stack([p,H*.76,w,H*.19],[{k:'body',z:27,f:'l',lh:1.5},{k:'foot',z:32,f:'l',w:600,g:40}],{va:'b'})}},
{n:'Bold colour',q:1,t:{eyebrow:'Sunday sessions',title:'Dinner, served properly.',sub:'Find your cure.',date:'',body:'Book a table for Sunday lunch or dinner.',cta:'Book a table',foot:'www.thephysician.bar'},
draw(W,H){const p=W*.08,qs=S.qr?W*.2:0,on=accentTextColor();R(0,0,W,H,'accent');logoAt(p,H*.05,W*.04,on,'l');rod(W-p-W*.03,H*.045,H*.1,on,W*.004);
stack([p,H*.28,W-2*p-qs,H*.66],[{k:'eyebrow',z:26,f:'l',up:1,ls:.25,c:on},{k:'title',z:128,lh:1.02,g:30,c:on},{k:'sub',z:44,g:30,c:on},{k:'date',z:34,f:'l',up:1,ls:.14,g:30,c:on},{k:'body',z:28,f:'b',g:36,c:on},{k:'cta',z:30,f:'l',up:1,ls:.16,g:40,c:on},{k:'foot',z:20,f:'l',g:24,ls:.05,c:on}],{al:'l',va:'b'});
if(S.qr)qrAt(W-p-qs,H*.94-qs,qs)}},
{n:'Night photo',ph:1,q:1,pi:'beef',t:{eyebrow:'Chef’s special',title:'Dry-aged beef, bone marrow',date:'',price:'£34',body:'Charcoal-grilled, watercress, roast shallot and a red wine jus.',cta:'Book a table',foot:'129 South Street, St Andrews · www.thephysician.bar'},
draw(W,H){const p=W*.08,qs=S.qr?W*.2:0,cr='#f6f1ea';photo(0,0,W,H);grad(0,H*.12,W,H*.88,'#0e0e1a',0,.97);grad(0,H*.4,W,H*.6,'#0e0e1a',0,.6);logoAt(p,H*.04,W*.036,cr,'l');
stack([p,H*.38,W-2*p-qs,H*.57],[{k:'eyebrow',z:26,f:'l',up:1,ls:.25,c:'accent'},{k:'title',z:112,lh:1.04,g:26,c:cr},{k:'price',z:56,g:24,c:'accent'},{k:'date',z:32,f:'l',up:1,ls:.14,g:20,c:cr},{k:'body',z:28,f:'b',g:30,c:cr,lh:1.4},{k:'cta',z:28,f:'l',up:1,ls:.16,g:36,c:cr},{k:'foot',z:19,f:'l',g:22,ls:.04,c:'#c9c3ba'}],{al:'l',va:'b'});
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
menuList([p,H*.35,w,H*.53],{zn:46,zd:28,zp:46,g:66,zh:22});stack([p,H*.91,w,H*.04],[{k:'foot',z:19,f:'l',c:'mute',ls:.04}],{va:'b'})}},
{n:'Festive',t:{title:'Festive Menu',items:IT2,foot:'Two courses £49 · Sunday 13th December'},
draw(W,H){const p=W*.09,w=W-2*p;R(p,H*.05,w,H*.011,'accent');stack([p,H*.09,w,H*.12],[{k:'title',z:84,up:1,w:700}]);
menuList([p,H*.26,w,H*.62],{zn:50,wn:700,up:1,zd:30,zp:46,g:96,zh:22});stack([p,H*.91,w,H*.04],[{k:'foot',z:21,f:'l',up:1,ls:.16,c:'mute'}],{va:'b'})}},
{n:'Centred',t:{sub:'Dinner',title:'Seasonal plates',items:IT3,foot:FT},
draw(W,H){const p=W*.1,w=W-2*p;stack([p,H*.05,w,H*.2],[{logo:34},{k:'sub',z:22,f:'l',up:1,ls:.3,g:46},{k:'title',z:70,g:12}],{va:'t'});
menuList([p,H*.26,w,H*.62],{al:'c',zn:50,zd:28,zp:38,g:58,zh:22});stack([p,H*.91,w,H*.04],[{k:'foot',z:18,f:'l',c:'mute',ls:.04}],{va:'b'})}},
{n:'Photo header',ph:1,pi:'prawns',t:{title:'Sharing plates',items:IT1,foot:FT},
draw(W,H){const p=W*.09,w=W-2*p,ph=H*.27;photo(0,0,W,ph);grad(0,0,W,ph*.5,'#000000',.55,0);logoAt(W/2,H*.03,W*.04,'#ffffff','c');
stack([p,ph+H*.025,w,H*.1],[{k:'title',z:72},{bar:1,w:.3,h:8,c:'accent',g:20}],{al:'l',va:'t'});menuList([p,ph+H*.14,w,H*.56],{zn:38,zd:24,zp:38,g:54,zh:22,top:1});stack([p,H*.93,w,H*.03],[{k:'foot',z:18,f:'l',c:'mute',ls:.04}],{va:'b'})}}]};
window.AssetCategories['menu'] = CFG;
})();

(function () {
const AD='129 South Street, St Andrews, KY16 9UH · www.thephysician.bar',TM='Redeemable at any Dalton family venue. Valid for 12 months from purchase. One voucher per booking, not exchangeable for cash.';
function codeBox(x,y,s,inner,box,code){const fill=box||'ink',ink=code||'accent';R(x,y,s,s,fill);if(inner){X.strokeStyle=C(ink);X.lineWidth=Math.max(2,s*.006);X.strokeRect(x+s*.035,y+s*.035,s*.93,s*.93)}
if(S.qr)qrAt(x+s*.12,y+s*.12,s*.76);else put(T('code'),x+s/2,y+s/2,fnt('l',400,s*.085),s*.012,'c',C(ink))}
const cream=(n,deco,t)=>({n,q:1,t,draw(W,H){const p=W*.06,s=Math.min(H*.5,W*.26),sw=W*.2;R(0,0,W,H,'paper');R(0,0,sw,H,'accent');
deco?sprig(sw/2,H*.5,H*.62,C('paper'),C('ink')):rod(sw/2,H*.12,H*.76,C('paper'),W*.004);
stack([sw+p,H*.1,W-sw-2*p-s-p,H*.8],[{logo:30},{k:'eyebrow',z:20,f:'l',up:1,ls:.2,g:40},{k:'amount',z:118,g:6},{k:'to',z:26,g:20},{k:'msg',z:22,f:'b',c:'mute',g:10,lh:1.35},{k:'terms',z:13,f:'b',c:'mute',g:26,lh:1.4},{k:'foot',z:12,f:'l',c:'mute',g:10}],{al:'l',va:'t'});
codeBox(W-p-s,H-p-s,s,1)}});
const CFG={id:'voucher',title:'Gift Voucher Maker',sub:'Set the amount, the message and the code. Download and print or send.',qr:'Link for a QR code (optional – replaces the code text)',
sizes:[{n:'Wide card',d:'Print · 2480×1169',w:2480,h:1169},{n:'A5 landscape',d:'Print · 1748×1240',w:1748,h:1240},{n:'Digital 16:9',d:'Email · 1600×900',w:1600,h:900}],
fields:[['eyebrow','Label'],['amount','Amount'],['to','To / From'],['msg','Message',2],['terms','Terms',3],['foot','Address line'],['code','Voucher code']],
tpls:[
{n:'Brand accent',q:1,t:{eyebrow:'Gift voucher',amount:'£50',to:'',msg:'',terms:TM,foot:AD,code:'GIFT-0001'},
draw(W,H){const p=W*.07,s=Math.min(H*.6,W*.28),on=accentTextColor();R(0,0,W,H,'accent');logoAt(p,H*.1,W*.032,on,'l');
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
draw(W,H){const p=W*.1,w=W-2*p;R(p,H*.07,w,H*.01,'accent');logoAt(W/2,H*.13,W*.045,C('ink'),'c');stack([p,H*.25,w,H*.57],[{k:'eyebrow',z:26,f:'l',up:1,ls:.28},{k:'title',z:78,g:60,lh:1.08},{k:'body',z:28,f:'b',c:'mute',g:56,lh:1.4},{k:'price',z:66,g:60}]);stack([p,H*.87,w,H*.07],[{k:'foot',z:19,f:'b',c:'mute'}],{va:'b'})}},
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
draw(W,H){const p=W*.08;R(0,0,W,H*.015,'accent');stack([p,H*.08,W-2*p,H*.8],[{logo:50},{sp:1,g:H/U*.16},{k:'title',z:108,lh:1.06},{k:'sub',z:30,f:'l',up:1,ls:.16,g:60}]);stack([p,H*.88,W-2*p,H*.07],[{k:'foot',z:25,f:'b',c:'mute'}],{va:'b'})}},
{n:'Chef’s special',ph:1,pi:'beef',t:{eyebrow:'Chef’s special',title:'Dry-aged beef, bone marrow',price:'£34',foot:'Charcoal-grilled · watercress · red wine jus'},
draw(W,H){const ph=H*(H<=W?.5:.46),p=W*.08;photo(0,0,W,ph);stack([p,ph+H*.03,W-2*p,H-ph-H*.06],[{k:'eyebrow',z:24,f:'l',up:1,ls:.3},{k:'title',z:78,lh:1.1,g:34},{k:'price',z:40,c:'accent',g:24},{k:'foot',z:21,f:'b',c:'mute',g:24}])}},
{n:'Sunday sessions',ph:1,pi:'duck',t:{title:'Sunday Sessions',cta:'Book a table',foot:'www.thephysician.bar'},
draw(W,H){const ph=H*(H<=W?.5:.46),p=W*.08;photo(0,0,W,ph);stack([p,ph+H*.03,W-2*p,H-ph-H*.06],[{k:'title',z:118,w:700,lh:1.05},{k:'cta',z:25,f:'l',up:1,ls:.24,g:56},{k:'foot',z:20,f:'b',c:'mute',g:22}])}},
{n:'Christmas icon',t:{title:'Christmas Brunch',date:'Sunday 13th December',price:'2 courses + cocktail £49'},
draw(W,H){const p=W*.06,gh=Math.min(H*.34,W*.5);glass(W/2,H*.5-gh*.95-H*.02,gh,C('ink'),C('accent'));stack([p,H*.52,W-2*p,H*.4],[{k:'title',z:104,up:1,lh:1.04},{k:'date',z:32,f:'l',up:1,ls:.28,g:40},{k:'price',z:32,f:'l',up:1,ls:.04,c:accentTextColor(),bg:'accent',g:50}],{va:'t'})}},
{n:'Announcement',t:{eyebrow:'New on the menu',title:'The Sunday roast is back.',sub:'Every Sunday from 12',foot:'Book at www.thephysician.bar'},
draw(W,H){const p=W*.09,on=accentTextColor();R(0,0,W,H,'accent');rod(W/2,H*.07,H*.17,on,W*.004);stack([p,H*.28,W-2*p,H*.6],[{k:'eyebrow',z:26,f:'l',up:1,ls:.26,c:on},{k:'title',z:118,lh:1.04,g:36,c:on},{k:'sub',z:34,c:on,g:36}]);stack([p,H*.88,W-2*p,H*.06],[{k:'foot',z:22,f:'l',up:1,ls:.14,c:on}],{va:'b'})}}]};
window.AssetCategories['social'] = CFG;
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
