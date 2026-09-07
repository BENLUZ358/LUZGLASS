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
  _heightGroups(hEntries,out.shapes.length).forEach(g=>{
    // מידה משותפת נמתחת על מה שהיא מכסה בפועל
    const top=Math.min.apply(null,g.pts.map(p=>p.y1));
    const bot=Math.max.apply(null,g.pts.map(p=>p.y2));
    const lane=place('left',top,bot,20);
    dim('height',g.mm,asmL-lane,top,asmL-lane,bot,{
      zone:'left', lane:lane, idxs:g.idxs, idx:g.idxs[0],
      // קו שמכסה את כל השייפים אינו צריך קווי הפניה — אין ממה להבדילו
      leaderTo: g.all?null:g.pts.map(p=>({ idx:p.idx, x:p.ax, y:p.y1 })),
    });
  });

  // ── הפרזול, ומידותיו מימין להרכבה ──
  //
  // מידת פרזול יוצאת מחוץ להרכבה כולה ולא מפאת הפאנל שלה: פאה של פאנל
  // אמצעי יושבת בתוך הזכוכית של השכן, ושם המידה נחתה על הצירים עצמם.
  const js=(typeof lgJunctions==='function')?lgJunctions(shower):[];
  const isHinge=j=>!!(j&&/hinge/.test(j.type||''));

  // מידות הפרזול מקובצות בדיוק כמו הגבהים. שתי דלתות עם ציר ב-200 הן
  // מידה אחת, לא שתיים בשני נתיבים — החזרה היא מה שדחף אותן החוצה
  // מהקנבס ואת התוויות זו על זו.
  const hwPend=[];
  const hwAdd=(kind,mm,a,b,idx)=>{
    const g=hwPend.find(p=>p.kind===kind&&p.mm===mm&&Math.abs(p.a-a)<1&&Math.abs(p.b-b)<1);
    if(g) g.idxs.push(idx); else hwPend.push({kind,mm,a,b,idxs:[idx]});
  };
  // הזוויות יושבות בדיוק על פאת ההרכבה, ולכן הנתיב הראשון חייב לפנות
  // את הסמל שלהן — אחרת התווית נוחתת עליו.
  const HW_CLEAR=14;

  out.shapes.forEach(s=>{
    const src=shapes[s.idx]||{};
    const hTop=src.hingeTop!=null?src.hingeTop:LG_EDGE_MM;
    const hBot=src.hingeBot!=null?src.hingeBot:LG_EDGE_MM;

    if(s.kind==='door'){
      // הפאה שהדלת נתלית עליה נגזרת מהמנוע, לא משדה ידני
      const hingePrev=isHinge(js[s.idx]), hingeNext=isHinge(js[s.idx+1]);
      const hx = hingePrev ? s.x : hingeNext ? s.x+s.w
               : (src.hingeSide==='left'? s.x+s.w : s.x);
      out.hardware.push({kind:'hinge',idx:s.idx,x:hx,y:s.y+hTop*sc});
      out.hardware.push({kind:'hinge',idx:s.idx,x:hx,y:s.y+s.h-hBot*sc});

      hwAdd('hinge-top',hTop,s.y,s.y+hTop*sc,s.idx);
      hwAdd('hinge-bot',hBot,s.y+s.h-hBot*sc,s.y+s.h,s.idx);

      // ידית — בצד ההפוך לציר, ונמדדת מלמטה כברירת מחדל
      const handleOnRight = hx===s.x;
      const eMM=src.handleEdge!=null?src.handleEdge*10:LG_HANDLE_EDGE_MM;
      const hxU=handleOnRight ? s.x+s.w-eMM*sc : s.x+eMM*sc;
      const dMM=src.handleDist!=null?src.handleDist:Math.round(s.mmH/2);
      const ref=src.handleRef||'bottom';
      const hyU=ref==='top'? s.y+dMM*sc : s.y+s.h-dMM*sc;
      out.hardware.push({kind:'handle',idx:s.idx,x:hxU,y:hyU});

      hwAdd('handle-dist',dMM,ref==='top'?s.y:hyU,ref==='top'?hyU:s.y+s.h,s.idx);
      // +14 כדי לפנות את סמל הידית עצמו: הנתיב הראשון הוא 16, התווית
      // גבוהה 16, והסמל ברדיוס 9 — הם נגעו.
      const eLane=place('handle',Math.min(hxU,handleOnRight?s.x+s.w:s.x),
                                 Math.max(hxU,handleOnRight?s.x+s.w:s.x),34)+14;
      dim('handle-edge',eMM,Math.min(hxU,handleOnRight?s.x+s.w:s.x),hyU+eLane,
                             Math.max(hxU,handleOnRight?s.x+s.w:s.x),hyU+eLane,
          {idx:s.idx,zone:'handle',lane:eLane});
    } else {
      // זוויות קיר — הגובה עוקב אחרי הצירים שמולן, ואין קו מידה אלא אם
      // שינו את הזווית הזו במפורש
      const wallL=js[s.idx]&&js[s.idx].type==='bracket-wall';
      const wallR=js[s.idx+1]&&js[s.idx+1].type==='bracket-wall';
      let bTop=LG_EDGE_MM, bBot=LG_EDGE_MM;
      shapes.forEach((d,i)=>{ if(d&&d.kind==='door'){
        if(d.hingeTop!=null) bTop=d.hingeTop;
        if(d.hingeBot!=null) bBot=d.hingeBot; } });
      if(src.bracketTop!=null) bTop=src.bracketTop;
      if(src.bracketBot!=null) bBot=src.bracketBot;
      if(wallL){ out.hardware.push({kind:'bracket',idx:s.idx,x:s.x,y:s.y+bTop*sc});
                 out.hardware.push({kind:'bracket',idx:s.idx,x:s.x,y:s.y+s.h-bBot*sc}); }
      if(wallR){ out.hardware.push({kind:'bracket',idx:s.idx,x:s.x+s.w,y:s.y+bTop*sc});
                 out.hardware.push({kind:'bracket',idx:s.idx,x:s.x+s.w,y:s.y+s.h-bBot*sc}); }
      if(src.bracketTop!=null) hwAdd('bracket-top',bTop,s.y,s.y+bTop*sc,s.idx);
      if(src.bracketBot!=null) hwAdd('bracket-bot',bBot,s.y+s.h-bBot*sc,s.y+s.h,s.idx);
      // ציר על קבוע שדלת נתלית עליו
      if(isHinge(js[s.idx]))   { out.hardware.push({kind:'hinge-on-fixed',idx:s.idx,x:s.x,y:s.y+bTop*sc});
                                 out.hardware.push({kind:'hinge-on-fixed',idx:s.idx,x:s.x,y:s.y+s.h-bBot*sc}); }
      if(isHinge(js[s.idx+1])) { out.hardware.push({kind:'hinge-on-fixed',idx:s.idx,x:s.x+s.w,y:s.y+bTop*sc});
                                 out.hardware.push({kind:'hinge-on-fixed',idx:s.idx,x:s.x+s.w,y:s.y+s.h-bBot*sc}); }
    }
  });

  // מידה אחת לכל (סוג, ערך, קטע), עם קו הפניה לכל שייף שהיא מתארת.
  hwPend.forEach(p=>{
    const lane=place('right',p.a,p.b,String(p.mm).length*8+16)+HW_CLEAR;
    dim(p.kind,p.mm,asmR+lane,p.a,asmR+lane,p.b,{
      idx:p.idxs[0], idxs:p.idxs, zone:'right', lane:lane,
      leaderTo:p.idxs.map(i=>{
        const sh=out.shapes[i];
        return { idx:i, x:sh.x+sh.w/2, y:/top$/.test(p.kind)?p.b:p.a };
      }),
    });
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

  const first=_layoutPass(shower,cW,MG,MG);
  if(!first.overflow||(first.overflow.l<0.5&&first.overflow.r<0.5)) return first;

  // אף צד לא עובר 30% מהקנבס: עדיף מידה שנוגעת בשפה מזכוכית שנעלמה.
  const cap=Math.round(cW*0.30);
  const l=Math.min(cap,Math.ceil(MG+first.overflow.l));
  const r=Math.min(cap,Math.ceil(MG+first.overflow.r));
  return _layoutPass(shower,cW,l,r);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgLayout: lgLayout };
