// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-layout.js  v1.0
//  איפה כל דבר יושב על השרטוט. טהור: בלי קנבס, בלי DOM, בלי Firebase.
// ════════════════════════════════════════════════════════════════════════
//
//  הגאומטריה הייתה כלואה בתוך הצייר, בדיוק כמו שחוקי הפרזול היו כלואים
//  שם לפני lg-shapes.js. drawSinglePanel גם חישב מיקום וגם צייר, ולכן
//  אי אפשר היה לבדוק את החישוב בלי דפדפן — והבדיקות נאלצו להסתפק
//  בחיפוש מחרוזות בקובץ.
//
//  זה עלה ביוקר: **כל באג ציור בפרויקט הזה עבר את כל הבדיקות.** מידות
//  שנחתו על הצירים שהן מתארות, מידות שנפלו מחוץ לקנבס, ‏.map על אובייקט
//  שאין לו .map — כולם ירוקים, כי מחרוזת אכן הייתה בקובץ.
//
//  עכשיו הפריסה היא פונקציה: מקלחון נכנס, קואורדינטות יוצאות. השאלה
//  הופכת למה שהיא באמת — האם שני המלבנים האלה נחתכים, האם הנקודה הזו
//  בתוך הקנבס — ואפשר לענות עליה בלי לצייר כלום.

// ─── נתיבי מידה ─────────────────────────────────────────────────────────
//
// לכל מידה נתיב במרחק קבוע מהאובייקט, והיא מקבלת את **הנתיב הקרוב ביותר
// שבו הקטע שלה פנוי**. מה שמזיז מידה החוצה הוא חפיפה בפועל, לא עצם
// קיומה של מידה אחרת: שני רוחבים סמוכים נוגעים רק בקצה ולכן חולקים
// שורה, בדיוק כמו שרטט שמצייר שרשרת מידות ביד.
//
// ISO 129 — הקטנה קרובה לאובייקט, הגדולה רחוקה, כדי שקו של מידה גדולה
// לא יחצה קו של קטנה. זה נובע מכך שהרוחב הכולל מוקצה אחרון.
function _lanesFor(cW){
  if(cW<=430) return { first:16, step:20 };
  if(cW<=900) return { first:20, step:26 };
  return { first:24, step:32 };
}

function _mkLanes(cfg){
  const zones={};
  return function place(zone,a,b,textPx){
    const lo0=Math.min(a,b), hi0=Math.max(a,b), mid=(lo0+hi0)/2;
    // קטע קצר עם תווית ארוכה תופס את רוחב התווית, לא את אורך הקו
    const need=Math.max(hi0-lo0, textPx||0);
    const lo=mid-need/2, hi=mid+need/2;
    const lanes=zones[zone]||(zones[zone]=[]);
    for(let i=0;i<lanes.length;i++){
      if(!lanes[i].some(s=>lo<s.hi&&hi>s.lo)){ lanes[i].push({lo,hi}); return cfg.first+i*cfg.step; }
    }
    lanes.push([{lo,hi}]);
    return cfg.first+(lanes.length-1)*cfg.step;
  };
}

// ─── מודדים כל גובה, בלי לחזור על עצמנו ─────────────────────────────────
//
// מקלחון טיפוסי הוא 2000 2000 1985 2000 2000. מדידת כל אחד בנפרד הפכה
// את הציור לבלתי קריא; מדידת החריגים בלבד השאירה את השרטט בלי תשובה —
// אם לדלת אין קו, היא 2000 או שפשוט לא נמדדה? זכוכית נחתכת לפי המספר
// הזה, וספק הוא לא מצב שמותר להשאיר בו את מי שחותך.
//
// כל גובה מוצג, ושייפים באותו גובה חולקים קו אחד עם קו הפניה לכל אחד.
// המידות מגיעות כרשימת עוגנים — לשייף ישר עוגן אחד במרכזו, ולשייף
// משופע שניים, אחד לכל פאה. זכוכית משופעת נחתכת משני הגבהים, ולכן
// לציין רק אחד מהם זה לשלוח את החותך לנחש.
function _heightGroups(entries,nShapes){
  const list=entries.filter(o=>o.mm>0);
  if(!list.length) return [];
  const groups=[];
  list.forEach(o=>{
    const g=groups.find(x=>x.mm===o.mm);
    if(g) g.pts.push(o); else groups.push({mm:o.mm,pts:[o]});
  });
  groups.sort((a,b)=>b.mm-a.mm);
  return groups.map(g=>Object.assign(g,{
    idxs:g.pts.map(p=>p.idx),
    // קו שמכסה בדיוק שייף אחד לכל שייף אינו צריך קווי הפניה
    all: g.pts.length===list.length && list.length===nShapes,
  }));
}

const LG_DEF_W=500, LG_DEF_H=2000;
const LG_EDGE_MM=200;          // ציר או זווית, 20 ס"מ מהקצה
const LG_HANDLE_EDGE_MM=60;    // ידית, 6 ס"מ מהפאה

// באיזו פאה תלויה הדלת. המנוע קובע, לא שדה ידני: ‏hingeSide היה סותר
// את הצומת ודלתות צוירו עם הצירים בצד הידית.
function _hingeLeft(src,js,i){
  const isH=j=>!!(j&&/hinge/.test(j.type||''));
  if(isH(js[i]))   return true;
  if(isH(js[i+1])) return false;
  return (src&&src.hingeSide)!=='left';
}

// ─── הפריסה ─────────────────────────────────────────────────────────────
//
// מעבר אחד. השוליים נתונים לו מבחוץ, כי כמה נתיבים יידרשו מימין מתברר
// רק אחרי שהמידות הוקצו — ‏lgLayout מריץ אותו פעמיים.
function _layoutPass(shower,cW,mgL,mgR){
  const cfg=_lanesFor(cW);
  const place=_mkLanes(cfg);

  const shapes=(shower&&shower.shapes)||[];
  const out={ canvas:{w:cW,h:0}, scale:1, lanes:cfg, margins:{l:mgL,r:mgR},
              shapes:[], dims:[], hardware:[] };
  if(!shapes.length){ out.canvas.h=200; return out; }

  const MG=mgL;
  const totalMM=shapes.reduce((n,s)=>n+((s&&s.w)||LG_DEF_W),0);
  // גובה שייף: משופע נמדד לפי הפאה הגבוהה, ישר לפי h. ‏slopeH גובר על h,
  // אחרת ברירת המחדל 2000 של שייף משופע בלי h הייתה מנפחת את הציור.
  const shapeMM=s=>{
    const a=(s&&s.slopeH1)||0, b=(s&&s.slopeH2)||0;
    return (a>0&&b>0&&a!==b) ? Math.max(a,b) : ((s&&s.h)||LG_DEF_H);
  };
  const maxMM=Math.max.apply(null,shapes.map(shapeMM));
  const sc=(cW-mgL-mgR)/Math.max(totalMM,1);
  const oy=Math.min(mgL,mgR);
  out.scale=sc;
  out.canvas.h=Math.round(maxMM*sc+oy*2);
  out.origin={x:mgL,y:oy};

  // ── השייפים ──
  let x=mgL;
  shapes.forEach((s,i)=>{
    // משופע: שתי פאות בשני גבהים. h1 היא הפאה השמאלית בקנבס, h2 הימנית.
    // תיבת השייף לוקחת את הגבוה מביניהם, והצייר מוריד את הפאה הנמוכה.
    const s1=(s&&s.slopeH1)||0, s2=(s&&s.slopeH2)||0;
    const sloped=s1>0&&s2>0&&s1!==s2;
    const mmH=shapeMM(s);
    const w=((s&&s.w)||LG_DEF_W)*sc, h=mmH*sc;
    // קו הרצפה הוא הייחוס. קבוע עומד עליו; דלת תלויה מקו המשקוף למעלה
    // ומרווח הרצפה נשאר מתחתיה — לכן דלת נמוכה מהקבוע בסנטימטר, והפער
    // בתחתית, בדיוק כמו במקלחון אמיתי.
    const kind=(s&&s.kind)||'fixed';
    const y = kind==='door' ? oy : oy+(maxMM-mmH)*sc;
    const o={ idx:i, id:(s&&s.id)||('s'+i), kind:kind,
              label:(s&&s.label)||'', x:x, y:y, w:w, h:h,
              mmW:(s&&s.w)||LG_DEF_W, mmH:mmH };
    if(sloped) o.slope={h1:s1,h2:s2};
    out.shapes.push(o);
    x+=w;
  });
  const asmL=mgL, asmR=mgL+totalMM*sc, asmB=oy+maxMM*sc;

  // איפה יושבת התווית לאורך הקו, כשבר של אורכו.
  //
  // שני קווי גובה שכנים נבדלים ברוחב נתיב אחד — 20 פיקסלים בפלאפון —
  // אבל התווית רחבה כ-38, ולכן שתיהן חפפו למרות ששני הקווים לא. הזזת
  // התווית לאורך הקו פותרת את זה בלי להרחיב את הנתיבים ולגזול מהזכוכית.
  const LABEL_T=[0.5,0.34,0.66,0.24,0.76,0.42,0.58];
  const labelT=lane=>LABEL_T[Math.round((lane-cfg.first)/cfg.step)%LABEL_T.length];

  // תווית על קו אנכי נקראת מלמטה למעלה, כמו בכל שרטוט. זה לא קישוט:
  // תווית שכובה תופסת 38 פיקסלים לרוחב ונתיב הוא 20, ולכן שתי מידות
  // בשני נתיבים שכנים חפפו למרות שהקווים עצמם לא נגעו. מסובבת, היא
  // תופסת 16 לרוחב ונכנסת. הצייר חייב לסובב בפועל — ‏rot אומר לו.
  const dim=(kind,text,x1,y1,x2,y2,extra)=>{
    const e=extra||{};
    out.dims.push(Object.assign({kind,text:String(text),x1,y1,x2,y2,
      rot: Math.abs(x2-x1)<Math.abs(y2-y1) ? 90 : 0,
      t: e.lane!=null?labelT(e.lane):0.5},e));
  };

  // ── רוחב לכל שייף, ואז הרוחב הכולל מעליהם ──
  out.shapes.forEach(s=>{
    const lane=place('top',s.x,s.x+s.w,String(s.mmW).length*8+16);
    dim('width',s.mmW,s.x,oy-lane,s.x+s.w,oy-lane,{idx:s.idx,zone:'top',lane:lane});
  });
  if(out.shapes.length>1){
    const lane=place('top',asmL,asmR,String(totalMM).length*8+30);
    dim('total',totalMM,asmL,oy-lane,asmR,oy-lane,{zone:'top',lane:lane});
  }

  // ── גבהים, משמאל להרכבה ──
  //
  // כל שייף תורם עוגן אחד במרכזו; שייף משופע תורם שניים, אחד לכל פאה,
  // כי משם נגזרות שתי מידות החיתוך.
  const hEntries=[];
  out.shapes.forEach(s=>{
    if(s.slope){
      const tallL=s.slope.h1>=s.slope.h2;
      hEntries.push({idx:s.idx, mm:Math.max(s.slope.h1,s.slope.h2),
                     ax:tallL?s.x:s.x+s.w, y1:s.y, y2:s.y+s.h});
      const shortMM=Math.min(s.slope.h1,s.slope.h2);
      hEntries.push({idx:s.idx, mm:shortMM,
                     ax:tallL?s.x+s.w:s.x, y1:s.y+s.h-shortMM*sc, y2:s.y+s.h});
    } else {
      hEntries.push({idx:s.idx, mm:s.mmH, ax:s.x+s.w/2, y1:s.y, y2:s.y+s.h});
    }
  });
  // מנגנון הנחה אחד לכל המידות האנכיות. קודם הגבהים והפרזול הוקצו
  // בשתי מערכות נפרדות שלא ראו זו את זו, ולכן שתי מידות יכלו לנחות
  // באותו מקום בלי שאף אחת מהן תדע.
  const vPlaced=[];
  const placeV=(x0,step,lo,hi)=>{
    let x=x0, k=0;
    while(k<10 && vPlaced.some(q=>Math.abs(q.x-x)<18 && lo<q.hi && hi>q.lo)) x=x0+(++k)*step;
    vPlaced.push({x:x,lo:lo,hi:hi});
    return x;
  };

  const hGroups=_heightGroups(hEntries,out.shapes.length);
  hGroups.forEach(g=>{
    // מידה משותפת נמתחת על מה שהיא מכסה בפועל
    const top=Math.min.apply(null,g.pts.map(p=>p.y1));
    const bot=Math.max.apply(null,g.pts.map(p=>p.y2));

    // הגובה יוצא לצד שהשייפים שלו יושבים בו. הדלת בקצה הימני והמידה
    // שלה בקצה השמאלי — עם קו הארכה שחוצה את כל הזכוכית כדי להגיע
    // אליה — בזמן שמימין לא היה כלום. הצד הקרוב תמיד פנוי יותר.
    const cx=g.pts.reduce((n,p)=>n+p.ax,0)/g.pts.length;
    const right = !g.all && cx>(asmL+asmR)/2;
    const s=right?1:-1, edge=right?asmR:asmL;
    const x=placeV(edge+s*cfg.first, s*cfg.step, Math.min(top,bot)-13, Math.max(top,bot)+13);

    // קווי הפניה אלכסוניים מכל מידה אל מרכז כל שייף חצו את הזכוכית
    // מפינה לפינה. שרטוט טכני לא עושה את זה: קו ההארכה **אופקי**, יוצא
    // מקו המידה בגובה הקצה ונעצר בשייף הרחוק ביותר שהמידה מכסה.
    const far=g.all?null:(right?Math.min.apply(null,g.pts.map(p=>p.ax))
                               :Math.max.apply(null,g.pts.map(p=>p.ax)));
    dim('height',g.mm,x,top,x,bot,{
      zone:right?'right':'left', lane:Math.abs(x-edge), idxs:g.idxs, idx:g.idxs[0],
      ext: far==null?null:[{x1:x,y1:top,x2:far,y2:top},{x1:x,y1:bot,x2:far,y2:bot}],
    });
  });

  // ── הפרזול ומידותיו, כל אחת ליד הפאה שלה ──
  //
  // ניסיון קודם הוציא את כל מידות הפרזול מחוץ להרכבה, כדי שלא ידרסו את
  // הסמלים. זה אכן פינה אותן — ובאותה תנועה ניתק אותן ממה שהן מתארות:
  // ציר בפאה השמאלית נמדד במספר בקצה הימני, ובין השניים קו מקווקו
  // שחצה את כל הזכוכית. שמונה קווים כאלה הפכו את השרטוט לסבך.
  //
  // מידה יושבת ליד מה שהיא מודדת. הקו יורד לצד הפאה שהפרזול עליה,
  // במרווח שמפנה את הסמל — וקווי ההפניה מתייתרים מעצמם.
  const js=(typeof lgJunctions==='function')?lgJunctions(shower):[];
  const isHinge=j=>!!(j&&/hinge/.test(j.type||''));

  // הקיבוץ הוא לפי פאה: ציר וזווית באותה פאה ובאותו גובה הם מידה אחת,
  // אבל שתי פאות שונות מקבלות כל אחת את שלה. קיבוץ גלובלי מיזג את כל
  // ה-200 של הציור למספר בודד, ואז לחצי מהפרזול לא היה גובה כלל.
  const hwPend=[];
  const hwAdd=(kind,mm,a,b,idx,face,outward)=>{
    const g=hwPend.find(p=>p.kind===kind&&p.mm===mm&&Math.abs(p.face-face)<1&&
                           Math.abs(p.a-a)<1&&Math.abs(p.b-b)<1);
    if(g){ if(g.idxs.indexOf(idx)<0) g.idxs.push(idx); }
    else hwPend.push({kind,mm,a,b,face,outward,idxs:[idx]});
  };
  // מרווח שמפנה את סמל הפרזול (רדיוס 9) מהתווית (רוחב 16 מסובבת)
  const HW_GAP=20;

  // הפרזול נתלה על **הצומת**, לא על השייף, ולכן הוא נספר פעם אחת — בדיוק
  // כמו ב-lg-shapes.js. קודם הדלת ציירה את הציר שלה והקבוע שלידה צייר
  // אותו שוב, אותו ציר פיזי פעמיים בשני גבהים אפשריים; וזווית בין שני
  // קבועים לא צוירה בכלל, כי הקוד חיפש רק זווית קיר.
  const nJ=out.shapes.length;
  const jx=j=>j<=0?asmL:(j>=nJ?asmR:out.shapes[j].x);

  // הזוויות עוקבות אחרי הצירים שבציור; אם אין צירים — 20 ס"מ.
  let defTop=LG_EDGE_MM, defBot=LG_EDGE_MM;
  shapes.forEach(d=>{ if(d&&d.kind==='door'){
    if(d.hingeTop!=null) defTop=d.hingeTop;
    if(d.hingeBot!=null) defBot=d.hingeBot; } });

  for(let j=0;j<=nJ;j++){
    const jt=(js[j]||{}).type;
    if(!jt) continue;
    const hinge=/hinge/.test(jt);
    const L=out.shapes[j-1], R=out.shapes[j];
    // ציר נתלה על הדלת; זווית מוברגת לקבוע
    const host = hinge ? ((L&&L.kind==='door')?L:(R&&R.kind==='door')?R:(L||R))
                       : ((L&&L.kind!=='door')?L:(R&&R.kind!=='door')?R:(L||R));
    if(!host) continue;
    const src=shapes[host.idx]||{};
    const mmT = hinge ? (src.hingeTop!=null?src.hingeTop:LG_EDGE_MM)
                      : (src.bracketTop!=null?src.bracketTop:defTop);
    const mmB = hinge ? (src.hingeBot!=null?src.hingeBot:LG_EDGE_MM)
                      : (src.bracketBot!=null?src.bracketBot:defBot);
    const fx=jx(j), yT=host.y+mmT*sc, yB=host.y+host.h-mmB*sc;
    out.hardware.push({kind:hinge?'hinge':'bracket',idx:host.idx,junction:j,jType:jt,x:fx,y:yT});
    out.hardware.push({kind:hinge?'hinge':'bracket',idx:host.idx,junction:j,jType:jt,x:fx,y:yB});
    hwAdd(hinge?'hinge-top':'bracket-top',mmT,host.y,yT,host.idx,fx,'start');
    hwAdd(hinge?'hinge-bot':'bracket-bot',mmB,yB,host.y+host.h,host.idx,fx,'end');
  }

  // ── הידית ──
  out.shapes.forEach(s=>{
    if(s.kind!=='door') return;
    const src=shapes[s.idx]||{};
    // הפאה שהדלת נתלית עליה נגזרת מהמנוע, לא משדה ידני
    const hingeLeft=_hingeLeft(src,js,s.idx);
    const handleOnRight=hingeLeft;
    const eMM=src.handleEdge!=null?src.handleEdge*10:LG_HANDLE_EDGE_MM;
    const face=handleOnRight ? s.x+s.w : s.x;
    const hxU=handleOnRight ? face-eMM*sc : face+eMM*sc;
    const dMM=src.handleDist!=null?src.handleDist:Math.round(s.mmH/2);
    const ref=src.handleRef||'bottom';
    const hyU=ref==='top'? s.y+dMM*sc : s.y+s.h-dMM*sc;
    // הצייר צריך לדעת לאן פונות רגלי הידית, ואיזה אורך למוט
    out.hardware.push({kind:'handle',idx:s.idx,x:hxU,y:hyU,
                       len:Math.max(120*sc,24), toward:handleOnRight?-1:1});

    hwAdd('handle-dist',dMM,ref==='top'?s.y:hyU,ref==='top'?hyU:s.y+s.h,s.idx,hxU,
          ref==='top'?'start':'end');
    // מרחק הידית מהפאה — מידה אופקית, מתחת לידית שהיא מתארת
    const eLane=place('handle',Math.min(hxU,face),Math.max(hxU,face),34)+14;
    dim('handle-edge',eMM,Math.min(hxU,face),hyU+eLane,Math.max(hxU,face),hyU+eLane,
        {idx:s.idx,zone:'handle',lane:eLane});
  });

  // כל מידת פרזול יורדת לצד הפאה שלה. לאיזה צד — לזה שיש בו מקום: בין
  // חמישה פאנלים על מסך פלאפון פאנל שלם הוא 36 פיקסלים, ומידה שיוצאת
  // תמיד שמאלה הייתה נוחתת על הפרזול של הפאה הקודמת.
  const faces=hwPend.map(p=>p.face).sort((a,b)=>a-b);
  const hwPlaced=[];
  hwPend.forEach(p=>{
    const before=faces.filter(f=>f<p.face-1).pop();
    const after =faces.filter(f=>f>p.face+1)[0];
    const roomL=p.face-(before!=null?before:asmL-mgL);
    const roomR=(after!=null?after:asmR+mgR)-p.face;
    const dir=roomR>roomL?1:-1;
    const room=Math.max(dir>0?roomR:roomL,0);

    // תווית מסובבת ארוכה מקו של 20 ס"מ בקנה מידה של פלאפון, ולכן היא
    // יוצאת מעבר לקצה. **פנימה, לתוך הזכוכית** — הקצה שליד הפרזול.
    // כלפי חוץ היא נדחפה מעל ראש הפאנל ונחתה על מידות הרוחב; פנימה היא
    // יושבת ליד הציר שהיא מתארת, וההיסט האופקי כבר מפנה את הסמל.
    const len=Math.abs(p.b-p.a), need=Math.max(String(p.mm).length*7+10,26);
    let t=0.5;
    if(len<need+6){
      const over=(need/2+5)/Math.max(len,1);
      t = p.outward==='start' ? 1+over : -over;
    }
    const my=p.a+(p.b-p.a)*t;
    const lo=Math.min(p.a,p.b,my-13), hi=Math.max(p.a,p.b,my+13);

    // ההקצאה חייבת לראות גם את ה-x. מידת ציר יוצאת ימינה מפאה אחת
    // ומידת ידית שמאלה מפאה אחרת, והשתיים נפגשות באמצע — טווחי ה-y
    // שלהן חופפים אבל הפאות שונות, ולכן הקצאה שמסתכלת רק על y נתנה
    // לשתיהן את הנתיב הראשון והתוויות נחתו זו על זו.
    const gap=Math.max(11,Math.min(HW_GAP,room/2));
    let x=placeV(p.face+dir*gap,dir*cfg.step,lo,hi);

    // דלת של 800 מ"מ היא 58 פיקסלים על מסך פלאפון, ובתוכם צריכים לשבת
    // גם גובה הציר וגם מרחק הידית. כשאין מקום, דחיפה נוספת הצידה רק
    // מרחיקה את המידה ממה שהיא מתארת ומנחיתה אותה על פרזול אחר.
    //
    // מידה היא או צמודה לפאה שלה, או יוצאת לשולי ההרכבה **עם קו הארכה
    // אופקי** אל הנקודה שהיא מודדת. יתומה באמצע היא לא אפשרות.
    let ext=null;
    const hwY=p.outward==='start'?p.b:p.a;
    if(Math.abs(x-p.face)>46){
      vPlaced.pop();
      const right=p.face>=(asmL+asmR)/2, edge=right?asmR:asmL, s=right?1:-1;
      x=placeV(edge+s*HW_GAP,s*cfg.step,lo,hi);
      ext=[{x1:x,y1:hwY,x2:p.face,y2:hwY}];
    }

    dim(p.kind,p.mm,x,p.a,x,p.b,
        {idx:p.idxs[0], idxs:p.idxs, zone:'hw', face:p.face, lane:Math.abs(x-p.face),
         t:t, ext:ext});
  });

  // מה חורג בפועל מהקנבס, לכל צד — זה מה שהמעבר השני מתקן.
  const boxW=d=>(d.rot?16:Math.max(String(d.text).length*7+10,26))/2;
  out.overflow={ l:0, r:0 };
  out.dims.forEach(d=>{
    const c=d.x1+(d.x2-d.x1)*d.t, half=boxW(d);
    out.overflow.l=Math.max(out.overflow.l, -Math.min(d.x1,d.x2,c-half));
    out.overflow.r=Math.max(out.overflow.r, Math.max(d.x1,d.x2,c+half)-cW);
  });

  return out;
}

// הקנבס נתון — רוחב הדפדפן. מה שגמיש הוא הזכוכית שבתוכו.
//
// מידות הפרזול יוצאות מימין להרכבה, וכמה נתיבים יידרשו שם ידוע רק אחרי
// שהוקצו. לכן מעבר ראשון מודד את החריגה, והשני מקצה לה שוליים — בלי
// להרחיב את הקנבס, שאי אפשר להרחיב, ובלי לנחש מראש רוחב שיאכל את
// הזכוכית גם כשאין פרזול בכלל.
function lgLayout(shower,opts){
  const o=opts||{};
  const cW=o.canvasW||800;
  const cfg=_lanesFor(cW);
  const MG=Math.min(cfg.first+cfg.step*2+26, Math.round(cW*0.20));

  // אף צד לא עובר 27% מהקנבס: עדיף מידה שנוגעת בשפה מזכוכית שנעלמה.
  const cap=Math.round(cW*0.27);
  let l=MG, r=MG, res=_layoutPass(shower,cW,l,r);

  // השוליים גדלים מונוטונית. הרחבת צד אחד משנה את קנה המידה ולכן גם את
  // מה שנדחס לצד השני, ושני מעברים בלבד התנדנדו בין השניים: הראשון
  // חרג ימינה, השני חרג שמאלה, ואיש מהם לא ראה את שניהם.
  for(let i=0;i<4 && res.overflow && (res.overflow.l>0.5||res.overflow.r>0.5);i++){
    const nl=Math.min(cap,Math.ceil(l+res.overflow.l));
    const nr=Math.min(cap,Math.ceil(r+res.overflow.r));
    if(nl===l&&nr===r) break;              // הגענו לתקרה, אין מה להוסיף
    l=nl; r=nr;
    res=_layoutPass(shower,cW,l,r);
  }
  return res;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgLayout: lgLayout };
