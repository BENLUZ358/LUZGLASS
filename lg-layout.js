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
// ‏sub הוא הצעד למידות המשניות — פרזול ופאות שיפוע. הן נכתבות בגופן
// קטן יותר, ולכן נכנסות בנתיבים צפופים יותר: שלוש מהן על אותה פאה
// חייבות להיכנס בתוך 46 פיקסלים ממנה, אחרת המספר מתרחק ממה שהוא מתאר.
function _lanesFor(cW){
  if(cW<=430) return { first:14, step:20, sub:17, subFirst:19 };
  if(cW<=900) return { first:18, step:24, sub:17, subFirst:19 };
  return { first:22, step:30, sub:17, subFirst:19 };
}
const LG_SZ_MAIN=10, LG_SZ_SUB=9;
const LG_HALF=sz=>sz*1.5/2+2;   // חצי רוחב תווית מסובבת, עם מרווח נשימה

function _mkLanes(cfg){
  const zones={};
  return function place(zone,a,b,textPx){
    const lo0=Math.min(a,b), hi0=Math.max(a,b), mid=(lo0+hi0)/2;
    // קטע קצר עם תווית ארוכה תופס את רוחב התווית, לא את אורך הקו
    const need=Math.max(hi0-lo0, textPx||0);
    const lo=mid-need/2, hi=mid+need/2;
    const lanes=zones[zone]||(zones[zone]=[]);
    // סבילות של חצי פיקסל. שני רוחבים סמוכים נגמרים ומתחילים באותה
    // נקודה, ובחשבון צף הקצה יוצא 493.00001 מול 492.99999 — מספיק כדי
    // שייחשבו חופפים. מידה אחת מתוך חמש קפצה משורת הרוחבים לשורת
    // הרוחב הכולל, בלי שום סיבה שנראית בציור.
    for(let i=0;i<lanes.length;i++){
      if(!lanes[i].some(s=>lo<s.hi-0.5&&hi>s.lo+0.5)){ lanes[i].push({lo,hi}); return cfg.first+i*cfg.step; }
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
const LG_BRACKET_INSET=25;     // זווית קיר-זכוכית, 2.5 ס"מ מהפאה פנימה
// קוטר הקדח בזכוכית. זווית וציר יושבים על בורג עבה יותר מידית.
const LG_HOLE_BRACKET=20, LG_HOLE_HANDLE=12;
// עד כמה הפרש גובה בין קבוע לדלת עדיין נבלע ביישור עליון, ומה המרווח
// מהרצפה כשהוא כבר לא נבלע. שניהם במילימטרים.
const LG_TOP_ALIGN=20, LG_DOOR_GAP=20;
// אילו תפקידים נולדים מצומת. רק אלה מושמטים כשהצומת כבר ייצר אותם;
// זווית רצפה, שאינה שייכת לשום צומת, תמיד שורדת.
const _LG_JUNCTION_ROLE={'hinge':1,'hinge-gg':1,'hinge-wall':1,
                         'bracket-wall':1,'bracket-gg':1};
// תפקיד → איך הוא מצויר. ציר הוא סמל מלא; זווית וידית הן קדח חשוף.
function _lgHoleKind(role){
  return /hinge/.test(role) ? 'hinge' : /bracket/.test(role) ? 'bracket' : 'hole';
}
const MAX_NEAR=56;             // כמה רחוק מותר למידה לשבת ממה שהיא מודדת
const LG_GLASS_KG=2.5;         // ק"ג למ"ר לכל מ"מ עובי — זכוכית מחוסמת

// באיזו פאה תלויה הדלת. המנוע קובע, לא שדה ידני: ‏hingeSide היה סותר
// את הצומת ודלתות צוירו עם הצירים בצד הידית.
function _hingeLeft(src,js,i){
  const isH=j=>!!(j&&/hinge/.test(j.type||''));
  if(isH(js[i]))   return true;
  if(isH(js[i+1])) return false;
  return (src&&src.hingeSide)!=='left';
}

// ─── באיזו פאה יורד השיפוע ───────────────────────────────────────────────
//
// שיפוע יכול לרדת בכל אחת מארבע הפאות, והלקוח בוחר. אלה רק ברירות
// המחדל לכשלא בחר:
//
//   • מקלחון נחתך ברצפה — האגן מנוקז — ולכן 'bottom' היא ברירת המחדל.
//   • שיפוע אנכי בקבוע יורד בפאה שנוגעת בקיר, כי הקיר הוא זה שלא ישר.
//   • שיפוע אנכי בדלת יורד בצד הידית. לא בצד הציר: שם הדלת נתלית,
//     ופאה משופעת מתחת לציר לא נותנת לו מה לאחוז.
//
// אופקי (top/bottom) נמדד בשני גבהים — שמאל וימין; אנכי (left/right)
// בשני רוחבים — עליון ותחתון. **השניים אינם מוציאים זה את זה**: זכוכית
// שנחתכת גם מול קיר לא ישר וגם מול רצפה מנוקזת היא מרובע שארבע פאותיו
// שונות, וכל אחת מהן צריכה מידה משלה. פחות מזה, והחותך מנחש פינה.
function _slopeOf(src,js,i){
  const h1=(src&&src.slopeH1)||0, h2=(src&&src.slopeH2)||0;
  const w1=(src&&src.slopeW1)||0, w2=(src&&src.slopeW2)||0;
  const hasH=h1>0&&h2>0&&h1!==h2, hasW=w1>0&&w2>0&&w1!==w2;
  if(!hasH&&!hasW) return null;

  const pick=(v,set)=>set.indexOf(v)>=0?v:null;
  const one=src&&src.slopeSide;    // בחירה בודדת, כשיש רק שיפוע אחד
  const out={hSide:null,h1:h1,h2:h2,vSide:null,w1:w1,w2:w2};

  if(hasH) out.hSide = pick(src&&src.slopeSideH,['top','bottom'])
                    || pick(one,['top','bottom']) || 'bottom';
  if(hasW) out.vSide = pick(src&&src.slopeSideV,['left','right'])
                    || pick(one,['left','right'])
                    || ((src&&src.kind)==='door'
                        ? (_hingeLeft(src,js,i)?'right':'left')          // הצד ההפוך לציר
                        : ((js[i]&&js[i].type==='bracket-wall')?'left'   // הפאה שנוגעת בקיר
                          :(js[i+1]&&js[i+1].type==='bracket-wall')?'right':'left'));
  return out;
}

// ─── פינוי מדרגה ─────────────────────────────────────────────────────────
//
// אגן מקלחת או מדרגה בנויה אוכלים מלבן מפינת הזכוכית התחתונה. המדרגה
// היא חלק מהבנייה ולכן **תמיד בצד הקיר** — וממילא לעולם לא בצד שדלת
// נתלית עליו, כי שם אין קיר.
//
// גם לפינוי עצמו יש שיפוע: המדף עשוי לרדת, ואז לפינוי גובה חיצוני
// וגובה פנימי. והרוחב שנשאר לזכוכית לצידו **מוזן ולא נגזר** — שני
// המספרים יחד הם מה שמראה אם הפינוי ישר או משופע, וזה מה שהחותך צריך.
function _notchOf(src,js,i){
  const w=(src&&src.notchW)||0, h=(src&&src.notchH)||0;
  if(!(w>0&&h>0)) return null;
  const pick=v=>(v==='left'||v==='right')?v:null;
  const side = pick(src&&src.notchSide)
    || ((js[i]&&js[i].type==='bracket-wall') ? 'left'
      : (js[i+1]&&js[i+1].type==='bracket-wall') ? 'right' : 'left');
  return { side:side, w:w, h:h,
           hIn: (src&&src.notchHIn)>0 ? src.notchHIn : h,
           rest:(src&&src.notchRest)>0 ? src.notchRest : null };
}

// חיתוך הפינוי מהמרובע. הפינוי מוחל **על גבי** הצורה שהשיפועים כבר
// בנו, ולא במקומה: אותה זכוכית יכולה גם לשבת על מדרגה וגם להיחתך מול
// קיר לא ישר. ארבע נקודות הופכות לשש, והצייר ממשיך לצייר נקודות.
function _applyNotch(P,nt,sc,mmW){
  const [TL,TR,BR,BL]=P;
  const yOn=(A,B,y)=>{ const d=B[1]-A[1];
    const t=Math.abs(d)<1e-6?0:(y-A[1])/d;  return A[0]+(B[0]-A[0])*t; };
  const xOn=(A,B,x)=>{ const d=B[0]-A[0];
    const t=Math.abs(d)<1e-6?0:(x-A[0])/d;  return A[1]+(B[1]-A[1])*t; };
  const right=nt.side==='right';
  const edge = right?[TR,BR]:[TL,BL];      // הפאה שהפינוי יורד בה
  const restMM = nt.rest!=null ? nt.rest : (mmW-nt.w);

  // שני גבהי הפינוי נמדדים **מהרצפה שמתחתיהם**, לא מנקודה אחת. כשתחתית
  // הזכוכית נוטה — רצפה מנוקזת — הרצפה מתחת לפינה הפנימית נמוכה מזו
  // שמתחת לכתף, והמדף יורש את הנטייה. מדידת שניהם מאותה פינה הייתה
  // מזיזה את הפינוי מהמקום שהוא באמת יושב בו.
  const yOut = edge[1][1]-nt.h*sc;
  const S=[yOn(edge[0],edge[1],yOut), yOut];
  const xNapprox = S[0] + (right?-1:1)*nt.w*sc;
  const yIn = xOn(BL,BR,xNapprox) - nt.hIn*sc;
  const N=[yOn(edge[0],edge[1],yIn) + (right?-1:1)*nt.w*sc, yIn];
  const bx = right ? BL[0]+restMM*sc : BR[0]-restMM*sc;
  const B=[bx, xOn(BL,BR,bx)];

  // שלוש הנקואות חוזרות בשמן ולא רק כאיברים בפוליגון. סדר האיברים
  // מתהפך בין פינוי שמאלי לימני, וכל צרכן שסופר אינדקסים יטעה באחד
  // מהשניים — הבדיקות שכתבתי טעו בדיוק כך לפני שהשמות נוספו.
  return { poly: right ? [TL,TR,S,N,B,BL] : [TL,TR,BR,B,N,S],
           shoulder:S, inner:N, foot:B, rest:restMM };
}

// ─── מהצייר אל המנוע ─────────────────────────────────────────────────────
//
// הצייר מחזיק שני מבנים: ‏panels (מה זה — דלת, קבוע, באיזה צד הציר)
// ו-‏pStates (כמה — רוחב, גובה, שיפוע). המנוע מכיר מבנה אחד. ההמרה
// יושבת כאן ולא בתוך הצייר, כי היא הנקודה היחידה שבה שני המודלים
// נוגעים — ומקום שבו שני מודלים נוגעים בלי בדיקה הוא מקום שבו הם
// מתפצלים.
//
// ‏pStates מגיע כאובייקט לפי מפתח מספרי ולא כמערך. זה כבר הפיל את
// הציור פעם אחת, כש-‏.map נקרא על משהו שאין לו ‏.map — ולכן הקריאה כאן
// מקבלת את שתי הצורות.
function lgFromPanels(panels,pStates,opts){
  const o=opts||{};
  const ps=i=>{ const v=pStates && (Array.isArray(pStates)?pStates[i]:pStates[i]);
                return v||{}; };
  const list=panels||[];

  // הקיר נגזר מ-wallSide של פאנלי הקצה, אלא אם נמסר במפורש. הצייר
  // מחזיק אותו על הפאנל, המנוע על המקלחון — וזה מה שקובע אם הצומת
  // הראשון הוא זווית קיר או קצה פתוח.
  // דלת בקצה נתלית תמיד על משהו, ולכן קצה כזה הוא קיר גם בלי wallSide.
  const wallOn=(p,side)=>{ const w=(p&&p.wallSide)||'';
    return w==='both'||w===side||(p&&p.type)==='door'; };
  const auto = list.length ? { right: wallOn(list[0],'right')?'wall':'open',
                               left:  wallOn(list[list.length-1],'left')?'wall':'open' }
                           : { right:'wall', left:'wall' };

  return {
    boundary: o.boundary || auto,
    finish: o.finish||'', quality: o.quality||'', thickness: o.thickness||null,
    shapes: list.map((p,i)=>{
      // הסוג נשמר כפי שהוא. הפיכת כל מה שאינו דלת לקבוע נתנה זוויות קיר
      // לצורה חופשית ולמראה — זכוכיות שאינן חלק מהרכבת המקלחון כלל.
      const st=ps(i), t=(p&&p.type)||'fixed';
      const kind = t==='door' ? 'door'
                 : (t==='shape'||t==='mirror'||t==='panel') ? t : 'fixed';
      const s={ id:(p&&p.id)||('p'+i), kind:kind, label:(p&&p.label)||'',
                w:Number(st.w)||(kind==='door'?800:500), h:Number(st.h)||2000 };
      // ‏"זוויות בלבד" היא הצהרה של מי שבחר את הצורה, ולכן היא עוברת
      // כמו שהיא. ‏undefined אינו "לא": פאנל שלא הצהיר כלום ממשיך
      // להתנהג כפי שהתנהג תמיד.
      if(p&&p.carriesDoor!=null) s.carriesDoor=p.carriesDoor;

      // ⚠️ מוסכמת הציר הפוכה בין השניים, וזה כבר היה באג: אצל המנוע
      // 'right' פונה לשייף הקודם במערך — שהוא **שמאל** על הקנבס.
      //
      // ‏hingeOnFixed נמדד על המערך ולכן הוא ישיר וגובר: הוא אומר מי
      // השכן, ורק זה קובע מה באמת מחובר. ‏hingeSide הוא גאומטריה על
      // הקנבס, וארבעת השדות הישנים אינם עקביים ביניהם.
      if(kind==='door'){
        s.hingeSide = (p&&p.hingeOnFixed)==='prev' ? 'right'
                    : (p&&p.hingeOnFixed)==='next' ? 'left'
                    : (p&&p.hingeSide)==='left'    ? 'right'
                    : (p&&p.hingeSide)==='right'   ? 'left'
                    : (i===0 ? 'right' : 'left');
      }

      // שיפוע — **תמיד לפי דגל, לעולם לא לפי נוכחות המספרים.**
      //
      // ‏mkPS נותן slopeH1:2000 ו-slopeH2:1800 לכל שייף כברירת מחדל. אלה
      // "מה יהיה אם תדליק", לא מצב. הסקה מנוכחותם הייתה הופכת כל זכוכית
      // במערכת למשופעת בבת אחת.
      //
      //   hasSlope   — שיפוע בגובה (או ברוחב, כש-slopeAxis הישן אומר כך)
      //   hasSlopeW  — שיפוע ברוחב, בנפרד. שני הדגלים יחד נותנים מרובע
      //                שארבע פאותיו שונות.
      const dH1=Number(st.slopeH1)||0, dH2=Number(st.slopeH2)||0;
      const dW1=Number(st.slopeW1)||0, dW2=Number(st.slopeW2)||0;
      const oldWidthAxis = st.hasSlope && st.slopeAxis==='width';

      if(st.hasSlope && !oldWidthAxis && dH1>0 && dH2>0){
        s.slopeH1=dH1; s.slopeH2=dH2;
        const side = st.slopeSideH || st.slopeSide;
        if(side==='top'||side==='bottom') s.slopeSideH=side;
      }
      if(st.hasSlopeW && dW1>0 && dW2>0){
        s.slopeW1=dW1; s.slopeW2=dW2;
        if(st.slopeSideV) s.slopeSideV=st.slopeSideV;
      } else if(oldWidthAxis && dH1>0 && dH2>0){
        // המבנה הישן: זוג אחד של מספרים משמש את הציר שנבחר
        s.slopeW1=dH1; s.slopeW2=dH2;
        if(st.slopeSide==='left'||st.slopeSide==='right') s.slopeSideV=st.slopeSide;
      }

      // פינוי מדרגה
      if(Number(st.notchW)>0 && Number(st.notchH)>0){
        s.notchW=Number(st.notchW); s.notchH=Number(st.notchH);
        if(Number(st.notchHIn)>0)  s.notchHIn=Number(st.notchHIn);
        if(Number(st.notchRest)>0) s.notchRest=Number(st.notchRest);
        if(st.notchSide)    s.notchSide=st.notchSide;
        if(st.notchBracket) s.notchBracket=st.notchBracket;
      }

      // פרזול ומידות שהלקוח שינה. ‏!=null ולא ||, כדי ש-0 יישמר.
      ['hingeTop','hingeBot','bracketTop','bracketBot','bracketInset',
       'handleDist','handleRef','thickness'].forEach(k=>{
        if(st[k]!=null && st[k]!=='') s[k]=st[k];
      });
      if(st.handleEdge!=null) s.handleEdge=Number(st.handleEdge);
      if(st.floorBracket) s.floorBracket=true;

      // קדחים שהזכוכית נושאת בעצמה. הם נחתכים בדיוק כמו הנגזרים, ולכן
      // עוברים סינון: ערך פגום היה מצייר קדח באפס-אפס במקום ליפול.
      if(Array.isArray(st.holes) && st.holes.length){
        const ok=st.holes.filter(h=>h&&h.role&&h.x&&h.y&&
                                    Number(h.x.mm)>=0&&Number(h.y.mm)>=0)
          .map(h=>({role:h.role, dia:Number(h.dia)>0?Number(h.dia):null,
                    x:{from:h.x.from==='right'?'right':'left', mm:Number(h.x.mm)},
                    y:{from:h.y.from==='top'?'top':'bottom',   mm:Number(h.y.mm)}}));
        if(ok.length) s.holes=ok;
      }
      return s;
    }),
  };
}

// ─── מתאר הזכוכית ────────────────────────────────────────────────────────
//
// המתאר הוא **מה שנחתך בפועל**, ולכן הוא נבנה פעם אחת במילימטרים ומשמש
// גם את הציור וגם את הליקוט. הציור מכפיל בקנה מידה ומזיז למקום; הליקוט
// מחשב ממנו שטח ומידות חיתוך. שני מחשבים נפרדים היו מתפצלים, והפער
// היה נשאר בלתי נראה עד שהזכוכית מגיעה חתוכה לא נכון.
//
// הנקודות יחסיות לפינה השמאלית-עליונה של תיבת השייף.
function lgOutline(shower){
  const shapes=(shower&&shower.shapes)||[];
  const js=(typeof lgJunctions==='function')?lgJunctions(shower):[];
  return shapes.map((s,i)=>{
    const sl=_slopeOf(s,js,i), nt=_notchOf(s,js,i);
    const mmW = (sl&&sl.vSide) ? Math.max(sl.w1,sl.w2) : ((s&&s.w)||LG_DEF_W);
    const mmH = (sl&&sl.hSide) ? Math.max(sl.h1,sl.h2) : ((s&&s.h)||LG_DEF_H);

    // נוסחה אחת לכל תשעת המקרים — בלי שיפוע, אופקי, אנכי, או שניהם.
    // הפאה שאינה משופעת היא העוגן, וארבע המידות קובעות את המרובע במלואו.
    const W1=(sl&&sl.vSide)?sl.w1:mmW, W2=(sl&&sl.vSide)?sl.w2:mmW;
    const H1=(sl&&sl.hSide)?sl.h1:mmH, H2=(sl&&sl.hSide)?sl.h2:mmH;
    const anchorL=!(sl&&sl.vSide==='left');
    const anchorT=!(sl&&sl.hSide==='top');
    let TLx,TRx,BLx,BRx,TLy,TRy,BLy,BRy;
    if(anchorL){ TLx=0;    BLx=0;    TRx=W1;      BRx=W2;      }
    else       { TRx=mmW;  BRx=mmW;  TLx=mmW-W1;  BLx=mmW-W2;  }
    if(anchorT){ TLy=0;    TRy=0;    BLy=H1;      BRy=H2;      }
    else       { BLy=mmH;  BRy=mmH;  TLy=mmH-H1;  TRy=mmH-H2;  }

    let poly=[[TLx,TLy],[TRx,TRy],[BRx,BRy],[BLx,BLy]], cut=null;
    if(nt){ cut=_applyNotch(poly,nt,1,mmW); poly=cut.poly; }

    return { idx:i, id:(s&&s.id)||('s'+i), kind:(s&&s.kind)||'fixed',
             label:(s&&s.label)||'', mmW:mmW, mmH:mmH, poly:poly,
             slope:sl, notch:nt, cut:cut };
  });
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
  const js=(typeof lgJunctions==='function')?lgJunctions(shower):[];
  const outlines=lgOutline(shower);
  const slopes=outlines.map(o=>o.slope);
  const notches=outlines.map(o=>o.notch);

  // גובה ורוחב של שייף: משופע נמדד לפי הפאה הגדולה. השדות של השיפוע
  // גוברים על h ו-w, אחרת ברירת המחדל 2000 של שייף משופע בלי h הייתה
  // מנפחת את הציור.
  const shapeMM=(s,i)=>{ const sl=slopes[i];
    return (sl&&sl.hSide) ? Math.max(sl.h1,sl.h2) : ((s&&s.h)||LG_DEF_H); };
  const shapeWM=(s,i)=>{ const sl=slopes[i];
    return (sl&&sl.vSide) ? Math.max(sl.w1,sl.w2) : ((s&&s.w)||LG_DEF_W); };

  const totalMM=shapes.reduce((n,s,i)=>n+shapeWM(s,i),0);

  // ── כמה כל לוח מורם מהרצפה ─────────────────────────────────────────
  //
  // הרצפה היא הייחוס היחיד. קודם היו שניים: הדלת נתלתה מראש הציור
  // והקבוע עמד על הרצפה — וכל עוד הגבהים היו שווים זה נראה נכון במקרה.
  // ברגע שהקבוע 1900 והדלת 2000, כל לוח נחת במקום אחר ואף אחד לא היה
  // במקום הנכון.
  //
  // הכלל:
  //   • **ברירת מחדל — מיישרים למעלה.** ראש המקלחון ישר, וההפרש נשאר
  //     למטה כמרווח בין הדלת לרצפה. ככה הדלת נפתחת, וככה זה נראה.
  //   • **חריג — הפרש גדול מ-20 מ"מ.** אז לא מכריחים יישור עליון: הדלת
  //     מקבלת מרווח קבוע של 20 מ"מ מהרצפה, וראשה נוחת איפה שגובהה מביא
  //     אותו. קבוע שגבוה מהדלתות פשוט ממשיך כלפי מעלה.
  //
  // המידה נמדדת מול **הקבוע**, לא מול הלוח הגבוה ביותר: דלת של 2000 ליד
  // קבוע של 1900 היא בדיוק המקרה החריג, ומול המקסימום ההפרש היה יוצא
  // אפס והחריג לא היה נכנס.
  const isDoor=s=>((s&&s.kind)||'fixed')==='door';
  const fixedTop=shapes.reduce((m,s,i)=>
    (!isDoor(s)&&!(s&&s.kind&&_LG_FREE[s.kind])) ? Math.max(m,shapeMM(s,i)) : m, 0);

  const lifts=shapes.map((s,i)=>{
    if(!isDoor(s)) return 0;
    // דלת בלי קבוע לידה אין מול מה ליישר אותה, והיא נשארת כפי שהייתה
    if(!fixedTop) return 0;
    const mmH=shapeMM(s,i), diff=Math.abs(fixedTop-mmH);
    // ‏Math.max כדי שדלת גבוהה מהקבוע ביותר מהמרווח לא תשקע מתחת לרצפה
    return diff<=LG_TOP_ALIGN ? Math.max(fixedTop-mmH,0) : LG_DOOR_GAP;
  });

  const maxMM=Math.max.apply(null,shapes.map((s,i)=>lifts[i]+shapeMM(s,i)));
  const sc=(cW-mgL-mgR)/Math.max(totalMM,1);
  const oy=Math.min(mgL,mgR);
  out.scale=sc;
  out.canvas.h=Math.round(maxMM*sc+oy*2);
  out.origin={x:mgL,y:oy};

  // ── השייפים ──
  let x=mgL;
  shapes.forEach((s,i)=>{
    const sl=slopes[i];
    const mmH=shapeMM(s,i), mmW=shapeWM(s,i);
    const w=mmW*sc, h=mmH*sc;
    // קו הרצפה הוא הייחוס. קבוע עומד עליו; דלת תלויה מקו המשקוף למעלה
    // ומרווח הרצפה נשאר מתחתיה — לכן דלת נמוכה מהקבוע בסנטימטר, והפער
    // בתחתית, בדיוק כמו במקלחון אמיתי.
    const kind=(s&&s.kind)||'fixed';
    // ההרמה מהרצפה נקבעה למעלה; כאן רק הופכים אותה למיקום על הציור.
    const y = oy+(maxMM-lifts[i]-mmH)*sc;

    // המתאר נבנה פעם אחת במילימטרים; כאן רק מכפילים ומזיזים למקום. כל
    // שייף נמסר לצייר כפוליגון, גם מלבן — ככה הצייר לא צריך לדעת מה זה
    // שיפוע, באיזה צד הוא יורד ומה ברירת המחדל.
    const ol=outlines[i];
    const poly=ol.poly.map(p=>[x+p[0]*sc, y+p[1]*sc]);
    const nt=notches[i];
    if(nt && ol.cut){
      const put=p=>[x+p[0]*sc, y+p[1]*sc];
      nt.shoulder=put(ol.cut.shoulder); nt.inner=put(ol.cut.inner);
      nt.foot=put(ol.cut.foot);         nt.restMM=ol.cut.rest;
    }

    const o={ idx:i, id:(s&&s.id)||('s'+i), kind:kind,
              label:(s&&s.label)||'', x:x, y:y, w:w, h:h,
              mmW:mmW, mmH:mmH, poly:poly };
    if(sl) o.slope=sl;
    if(nt) o.notch=nt;
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
  // כל תווית שהונחה נרשמת, כדי שהבאה אחריה תדע איפה לא לשבת. מנגנון
  // ההימנעות של המידות האנכיות עבד על קווים; תווית אופקית קצרה כמו
  // מרחק החור מהפאה חמקה ממנו ונחתה על שכנתה.
  const labels=[];
  const labelBox=(text,rot,x1,y1,x2,y2,t,size)=>{
    const sz=size||LG_SZ_MAIN;
    const mx=x1+(x2-x1)*t, my=y1+(y2-y1)*t;
    const len=Math.max(String(text).length*sz*0.64+8, sz*2.2);
    const w=rot?sz*1.5:len, h=rot?len:sz*1.5;
    return {lo:mx-w/2, hi:mx+w/2, top:my-h/2, bot:my+h/2};
  };
  const labelClear=b=>!labels.some(q=>b.lo<q.hi&&b.hi>q.lo&&b.top<q.bot&&b.bot>q.top);

  const dim=(kind,text,x1,y1,x2,y2,extra)=>{
    const e=extra||{};
    const rot=Math.abs(x2-x1)<Math.abs(y2-y1)?90:0;
    const t=e.t!=null?e.t:(e.lane!=null?labelT(e.lane):0.5);
    const size=e.size||LG_SZ_MAIN;
    labels.push(labelBox(text,rot,x1,y1,x2,y2,t,size));
    out.dims.push(Object.assign({kind,text:String(text),x1,y1,x2,y2,rot:rot,t:t,size:size},e));
  };

  const notchPend=[];
  // ── רוחב לכל שייף, ואז הרוחב הכולל מעליהם ──
  //
  // שיפוע אנכי נמדד בשני רוחבים, עליון ותחתון — כי זה מה שמודדים בשטח
  // כשהקיר לא ישר. השניים יושבים אחד מול השני, מעל הזכוכית ומתחתיה, כדי
  // שרואים מיד כמה הקיר סוטה.
  out.shapes.forEach(s=>{
    // הקצוות נקראים מהפוליגון עצמו, כדי שהמידה והצורה לא יוכלו לחלוק
    const P=s.poly, vs = s.slope && s.slope.vSide ? s.slope : null;
    const topMM = vs ? vs.w1 : s.mmW;
    const lane=place('top',P[0][0],P[1][0],String(topMM).length*8+16);
    dim('width',topMM,P[0][0],oy-lane,P[1][0],oy-lane,
        {idx:s.idx,zone:'top',lane:lane,field:vs?'slopeW1':'w'});
    if(vs){
      const bLane=place('bottom',P[3][0],P[2][0],String(vs.w2).length*8+16);
      dim('width',vs.w2,P[3][0],asmB+bLane,P[2][0],asmB+bLane,
          {idx:s.idx,zone:'bottom',lane:bLane,field:'slopeW2'});
    }
    // ── הפינוי ──
    //
    // הרוחב שנשאר לזכוכית לצד הפינוי נמדד בזכות עצמו ולא נגזר: שני
    // המספרים יחד — הפינוי ומה שנשאר — הם מה שמראה אם הפאה ישרה או
    // משופעת, וזה מה שהחותך צריך לדעת.
    if(s.notch){
      const nt=s.notch, right=nt.side==='right';
      const far = right ? P[0][0] : P[1][0];         // הפינה התחתונה הרחוקה מהפינוי
      const seg=(a,b)=>[Math.min(a,b),Math.max(a,b)];
      // הזכוכית שנשארה, לאורך התחתית
      const [r1,r2]=seg(far,nt.foot[0]);
      const rLane=place('bottom',r1,r2,String(nt.restMM).length*8+16);
      dim('width',nt.restMM,r1,asmB+rLane,r2,asmB+rLane,{idx:s.idx,zone:'bottom',lane:rLane});
      // רוחב הפינוי עצמו
      const [w1,w2]=seg(nt.inner[0],nt.shoulder[0]);
      const wLane=place('bottom',w1,w2,String(nt.w).length*8+16);
      dim('notch-w',nt.w,w1,asmB+wLane,w2,asmB+wLane,
          {idx:s.idx,zone:'bottom',lane:wLane,size:LG_SZ_SUB});
      notchPend.push({idx:s.idx, nt:nt, botY:asmB, right:right});
    }
  });
  if(out.shapes.length>1){
    const lane=place('top',asmL,asmR,String(totalMM).length*8+30);
    dim('total',totalMM,asmL,oy-lane,asmR,oy-lane,{zone:'top',lane:lane});
  }

  // מנגנון הנחה אחד לכל המידות האנכיות. קודם הגבהים והפרזול הוקצו
  // בשתי מערכות נפרדות שלא ראו זו את זו, ולכן שתי מידות יכלו לנחות
  // באותו מקום בלי שאף אחת מהן תדע.
  // ההקצאה חייבת לדעת כמה רחבה כל תווית. מידה ראשית ומידה משנית בשני
  // גדלים שונים, ומרווח קבוע שהספיק לשתי משניות לא הספיק לראשית לצידה.
  // סמל פרזול תופס מקום בדיוק כמו תווית, ולכן הוא נרשם באותה רשימה.
  // בלי זה מידת גובה נחתה על החור של הידית: הפאה נראתה פנויה כי אף
  // מידה לא ישבה שם, אבל הסמל כן.
  const vPlaced=[];
  const claim=(x,y)=>vPlaced.push({x:x,lo:y-10,hi:y+10,hw:9});
  const placeV=(x0,step,lo,hi,size,bound)=>{
    const hw=LG_HALF(size||LG_SZ_MAIN);
    const free=x=>!vPlaced.some(q=>Math.abs(q.x-x)<q.hw+hw && lo<q.hi && hi>q.lo);
    // מחפשים לשני הכיוונים מהמקום המועדף, לא רק החוצה. חיפוש בכיוון אחד
    // בלבד דחף מידה של דלת צרה אל מעבר לדלת עצמה, בזמן שהצד השני היה
    // פנוי — והמספר הפסיק לתאר את מה שהוא מודד.
    //
    // ‏bound חוסם צד שלם: מידת פרזול בקצה ההרכבה חייבת להישאר **בתוך**
    // הזכוכית. בלעדיו החיפוש הדו-כיווני הוציא אותה החוצה, אל מעבר
    // למידת הגובה הכללי — וההיררכיה התהפכה: הקטן רחוק, הגדול קרוב.
    const s=Math.abs(step)||16, d0=step<0?-1:1;
    const ok = bound ? (x=>free(x) && x>=bound[0] && x<=bound[1]) : free;
    const tries=[0];
    for(let k=1;k<=5;k++){ tries.push(d0*k*s); tries.push(-d0*k*s); }
    // אם אין מקום בתוך התחום, עדיף לחרוג ממנו מאשר לנחות על סמל: מספר
    // קצת רחוק עוד קריא, מספר על גבי ציר כבר לא.
    let x=x0, found=false;
    for(let i=0;i<tries.length && !found;i++) if(ok(x0+tries[i])){ x=x0+tries[i]; found=true; }
    for(let i=0;i<tries.length && !found;i++) if(free(x0+tries[i])){ x=x0+tries[i]; found=true; }
    vPlaced.push({x:x,lo:lo,hi:hi,hw:hw});
    return x;
  };

  // ── הפרזול ומידותיו, כל אחת ליד הפאה שלה ──
  //
  // ניסיון קודם הוציא את כל מידות הפרזול מחוץ להרכבה, כדי שלא ידרסו את
  // הסמלים. זה אכן פינה אותן — ובאותה תנועה ניתק אותן ממה שהן מתארות:
  // ציר בפאה השמאלית נמדד במספר בקצה הימני, ובין השניים קו מקווקו
  // שחצה את כל הזכוכית. שמונה קווים כאלה הפכו את השרטוט לסבך.
  //
  // מידה יושבת ליד מה שהיא מודדת. הקו יורד לצד הפאה שהפרזול עליה,
  // במרווח שמפנה את הסמל — וקווי ההפניה מתייתרים מעצמם.
  const isHinge=j=>!!(j&&/hinge/.test(j.type||''));

  // הקיבוץ הוא לפי פאה: ציר וזווית באותה פאה ובאותו גובה הם מידה אחת,
  // אבל שתי פאות שונות מקבלות כל אחת את שלה. קיבוץ גלובלי מיזג את כל
  // ה-200 של הציור למספר בודד, ואז לחצי מהפרזול לא היה גובה כלל.
  const hwPend=[];
  const hwAdd=(kind,mm,a,b,idx,face,outward,side)=>{
    const g=hwPend.find(p=>p.kind===kind&&p.mm===mm&&Math.abs(p.face-face)<1&&
                           p.side===side&&Math.abs(p.a-a)<1&&Math.abs(p.b-b)<1);
    if(g){ if(g.idxs.indexOf(idx)<0) g.idxs.push(idx); }
    else hwPend.push({kind,mm,a,b,face,outward,side,idx,idxs:[idx]});
  };
  // מרווח שמפנה את סמל הפרזול (רדיוס 9) מהתווית (רוחב 16 מסובבת)
  const HW_GAP=cfg.subFirst;

  // הפרזול נתלה על **הצומת**, לא על השייף, ולכן הוא נספר פעם אחת — בדיוק
  // כמו ב-lg-shapes.js. קודם הדלת ציירה את הציר שלה והקבוע שלידה צייר
  // אותו שוב, אותו ציר פיזי פעמיים בשני גבהים אפשריים; וזווית בין שני
  // קבועים לא צוירה בכלל, כי הקוד חיפש רק זווית קיר.
  const nJ=out.shapes.length;
  const jx=j=>j<=0?asmL:(j>=nJ?asmR:out.shapes[j].x);

  // איזו פאה של איזו זכוכית כבר קיבלה פרזול מהצומת. חור מוצהר שנופל על
  // פאה כזאת הוא **אותו חור** — לא שני. זה מה ששומר על "פרזול אחד לצומת"
  // גם כשהצורה מגיעה מהקטלוג עם הצירים מצוירים עליה.
  const derivedFaces={};

  const insetPend=[];
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
    // ציר תופס את שתי הזכוכיות ולכן יושב על הגבול. **זווית קיר-זכוכית
    // מוברגת דרך חור בזכוכית**, ולחור יש מרחק מהקצה — 2.5 ס"מ כברירת
    // מחדל. עד עכשיו הזוויות צוירו בדיוק על הפאה, ומי שקודח לפי הסקיצה
    // היה קודח בשפה.
    const face=jx(j);
    const inset = hinge ? 0
      : (src.bracketInset!=null?src.bracketInset:LG_BRACKET_INSET)*sc;
    // פנימה, לתוך הזכוכית של השייף שנושא את הפרזול
    const onLeft = Math.abs(face-host.x)<0.5;
    const into = onLeft ? 1 : -1;

    // ציר וזווית מוברגים **לזכוכית**, ולכן הם יושבים על הפאה כפי שהיא
    // באמת בגובה שלהם. פאה משופעת נוטה, והפרזול נוטה איתה; הצמדה
    // לתיבת השייף הייתה מציבה אותו לצד הזכוכית ולא עליה.
    const P=host.poly;
    const edge = onLeft ? [P[0],P[P.length-1]] : [P[1],P[2]];
    const xAt=(A,B,y)=>{ const d=B[1]-A[1];
      return Math.abs(d)<1e-6 ? A[0] : A[0]+(B[0]-A[0])*((y-A[1])/d); };

    // הפינוי חותך את **תחתית** הפאה החיצונית — שם כבר אין זכוכית. הזווית
    // התחתונה עוברת לפאה הפנימית של הפינוי, ונמדדת 20 ס"מ מהרצפה: זה
    // הקצה התחתון שיש בו זכוכית לקדוח בה.
    // איפה יושבת הזווית התחתונה כשיש פינוי — בחירה של הלקוח:
    //   'floor'    (ברירת מחדל) 20 ס"מ מהרצפה, על הפאה הפנימית של הפינוי
    //   'shoulder' 20 ס"מ מכתף הפינוי, על הפאה החיצונית
    //   'both'     שתיהן
    const nt=host.notch, floorY=host.y+host.h;
    const onNotch = nt && ((nt.side==='left')===onLeft);
    const where = onNotch ? (src.notchBracket||'floor') : 'floor';
    const yT=host.y+mmT*sc;
    const yB = (where==='shoulder') ? nt.shoulder[1]+mmB*sc : floorY-mmB*sc;
    const useInner = onNotch && where!=='shoulder' && yB>nt.inner[1];
    const botEdge = useInner ? [nt.inner,nt.foot] : edge;

    const xT=xAt(edge[0],edge[1],yT)+into*inset;
    const xB=xAt(botEdge[0],botEdge[1],yB)+into*inset;
    // ‏edgeX הוא איפה הזכוכית באמת עוברת בגובה של הפריט הזה — לא ה-x של
    // הצומת. הם נפרדים ברגע שיש שיפוע או פינוי, והצייר צריך את הראשון.
    // ציר וזווית מוברגים דרך **קדח** בזכוכית, בדיוק כמו ידית. מה שהחותך
    // צריך הוא המיקום והקוטר; סמל מלבני רק הסתיר את שניהם.
    const kindHw=hinge?'hinge':'bracket';
    const dia=LG_HOLE_BRACKET;
    // הצומת שייך ל**שתי** הפאות שנפגשות בו, לא רק לזו שנושאת את הפרזול.
    // ציר מתארח על הדלת, אבל הוא גם הציר של הקבוע שממול; אם רק הדלת
    // תסומן, קבוע שמגיע מהקטלוג עם צירים מצוירים יוסיף זוג שני ויֵצאו
    // ארבעה. אותה פיסת מתכת, שני קדחים, ספירה אחת.
    if(L) derivedFaces[L.idx+':right']=1;
    if(R) derivedFaces[R.idx+':left']=1;
    out.hardware.push({kind:kindHw,hole:true,dia:dia,idx:host.idx,junction:j,jType:jt,x:xT,y:yT,
                       face:face,into:into,source:'junction',
                       edgeX:xAt(edge[0],edge[1],yT)}); claim(xT,yT);
    out.hardware.push({kind:kindHw,hole:true,dia:dia,idx:host.idx,junction:j,jType:jt,x:xB,y:yB,
                       face:face,into:into,source:'junction',
                       edgeX:xAt(botEdge[0],botEdge[1],yB),
                       onNotch:botEdge!==edge}); claim(xB,yB);
    // הפרזול הוא פיסת מתכת אחת שעוברת דרך שתי הזכוכיות, אבל **כל זכוכית
    // נמדדת מהקצה שלה**. דלת תלויה מהמשקוף וקבוע עומד על הרצפה, ולכן
    // תחתית הדלת גבוהה בסנטימטר וחצי — ואותו ציר הוא 200 מהדלת ו-215
    // מהקבוע. מי שקודח בקבוע לפי המספר של הדלת מפספס.
    // **המידה נרשמת על הזכוכית שהיא מודדת.** שתי המידות ישבו בצד הדלת,
    // ואז ה-215 של הקבוע נקרא כאילו הוא של הדלת — שני מספרים על זכוכית
    // אחת, והזכוכית שהם מתארים בלי אף אחד.
    //
    // והעוגן: הזווית עצמה מוסטת פנימה לתוך הזכוכית שנושאת אותה, ולכן
    // מידה של הזכוכית השנייה שנתלית עליה נגררה לצד הלא נכון של הצומת.
    // היא נמדדת מהצומת; רק המידה של הנושא נצמדת לזווית.
    const kT=hinge?'hinge-top':'bracket-top', kB=hinge?'hinge-bot':'bracket-bot';
    const panes=[L,R].filter(Boolean);
    const sideOf=s=>(s===L?-1:1);
    const anchor=(s,x)=>(s===host?x:face);

    panes.forEach(s=>hwAdd(kT,Math.round((yT-s.y)/sc),s.y,yT,s.idx,
                           anchor(s,xT),'start',sideOf(s)));

    if(where==='shoulder'){
      hwAdd(kB,mmB,yB,nt.shoulder[1],host.idx,xB,'start',sideOf(host));
    } else {
      panes.forEach(s=>{ const b=s.y+s.h;
        hwAdd(kB,Math.round((b-yB)/sc),yB,b,s.idx,
              anchor(s,xB),'end',sideOf(s)); });
    }

    // 'both' — גם על הפאה החיצונית, מכתף הפינוי כלפי מעלה
    if(where==='both'){
      const y2=nt.shoulder[1]+mmB*sc;
      const x2=xAt(edge[0],edge[1],y2)+into*inset;
      out.hardware.push({kind:kindHw,hole:true,dia:LG_HOLE_BRACKET,idx:host.idx,junction:j,
                         jType:jt,x:x2,y:y2,face:face,into:into,source:'junction',
                         edgeX:xAt(edge[0],edge[1],y2)}); claim(x2,y2);
      hwAdd(hinge?'hinge-bot':'bracket-bot',mmB,nt.shoulder[1],y2,host.idx,x2,'start');
    }
    // 2.5 ס"מ הם ברירת המחדל וכל שרטט יודע אותם — קו מידה עליהם הוא
    // רעש. הוא מופיע רק כשהלקוח שינה את המרחק במפורש.
    if(inset>0 && src.bracketInset!=null){
      const ex=xAt(edge[0],edge[1],yT);
      insetPend.push({idx:host.idx, mm:src.bracketInset,
                      a:Math.min(ex,xT), b:Math.max(ex,xT), y:yT, into:into});
    }
  }

  // ── הידית ──
  const edgePend=[];
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
    // בשרטוט לחותך הזכוכית מה שקיים הוא **החור**. הידית מוברגת בו, וסמל
    // מפורט שלה רק מסתיר את מה שצריך לקדוח.
    out.hardware.push({kind:'hole',hole:true,dia:LG_HOLE_HANDLE,idx:s.idx,
                       source:'junction',role:'handle',x:hxU,y:hyU});
    claim(hxU,hyU);

    hwAdd('handle-dist',dMM,ref==='top'?s.y:hyU,ref==='top'?hyU:s.y+s.h,s.idx,hxU,
          ref==='top'?'start':'end');
    // מרחק החור מהפאה נפלט אחרון, כשכל שאר המידות כבר על הנייר
    edgePend.push({idx:s.idx, mm:eMM, a:Math.min(hxU,face), b:Math.max(hxU,face),
                   y:hyU, right:handleOnRight});
  });

  // ── חורים מוצהרים ────────────────────────────────────────────────────
  //
  // עד כאן כל קדח **נגזר** מהצומת: מי שכן קובע מה נקדח. זה נכון כשהלוח
  // יושב בהרכבה, ולא מספיק בשני מקרים:
  //
  //   • לקוח שמזמין לוח בודד להחלפה — נשברה לו זכוכית אחת, והוא צריך
  //     לראות בדיוק מה נחתך בה. אין לה שכנים שמהם אפשר לגזור.
  //   • קדח שאינו שייך לשום צומת — זווית רצפה, למשל — שאף כלל הרכבה
  //     לא ייצר לבד.
  //
  // לכן צורה יכולה **לשאת** את הקדחים שלה, וכל קדח נמדד כמו שקודחים
  // באמת: קוטר, ומרחק משתי פאות. הפאות נלקחות מהמצולע ולא מהתיבה, כדי
  // ששיפוע ופינוי יזיזו את הקדח איתם.
  //
  // קדח מוצהר שנופל על פאה שהצומת כבר טיפל בה מושמט — אותה פיסת מתכת,
  // קדח אחד, ספירה אחת; זה מה ששומר על הכלל שנקבע כשהציר הפסיק להיות
  // מצויר פעמיים. אבל **רק תפקיד של צומת** מושמט כך: זווית רצפה אינה
  // צומת, ולכן היא שורדת גם לצד זווית קיר על אותה פאה.
  out.shapes.forEach(s=>{
    const src=shapes[s.idx]||{};
    const list=src.holes;
    if(!list||!list.length) return;
    const P=s.poly, floorY=s.y+s.h;
    const xAt=(A,B,y)=>{ const d=B[1]-A[1];
      return Math.abs(d)<1e-6 ? A[0] : A[0]+(B[0]-A[0])*((y-A[1])/d); };
    const L=[P[0],P[P.length-1]], R=[P[1],P[2]];
    list.forEach(hl=>{
      if(!hl) return;
      const role=hl.role||'bracket-wall';
      const kind=_lgHoleKind(role);
      const hx=hl.x||{}, hy=hl.y||{};
      const fromLeft = hx.from!=='right';
      if(_LG_JUNCTION_ROLE[role] &&
         derivedFaces[s.idx+':'+(fromLeft?'left':'right')]) return;
      const y = hy.from==='top' ? s.y+(hy.mm||0)*sc : floorY-(hy.mm||0)*sc;
      const ex = fromLeft ? xAt(L[0],L[1],y) : xAt(R[0],R[1],y);
      const into = fromLeft ? 1 : -1;
      const x = ex+into*(hx.mm||0)*sc;
      const dia = hl.dia!=null ? hl.dia
                : kind==='hole' ? LG_HOLE_HANDLE : LG_HOLE_BRACKET;
      out.hardware.push({kind:kind,hole:true,dia:dia,idx:s.idx,x:x,y:y,
                         into:into,edgeX:ex,source:'declared',role:role});
      claim(x,y);
    });
  });

  // ── גבהים, משמאל להרכבה ──
  //
  // כל שייף תורם עוגן אחד במרכזו; שייף משופע תורם שניים, אחד לכל פאה,
  // כי משם נגזרות שתי מידות החיתוך.
  const hEntries=[];
  out.shapes.forEach(s=>{
    const hs = s.slope && s.slope.hSide ? s.slope : null;
    if(hs){
      // כל פאה נושאת את המידה שלה, בקצה שלה — אותו כלל כמו קצה ההרכבה.
      // הפוליגון כבר יודע איפה כל פאה מתחילה ונגמרת, ולכן נגזר ממנו:
      // בשיפוע כפול הפאה עצמה נוטה, וה-x שלה אינו x של התיבה.
      const P=s.poly;
      // כל פאה נושאת את **השדה** שלה ולא רק את המספר. בלי זה לחיצה על
      // 1800 של הפאה הימנית פתחה את הגובה הכללי, כי כל מידת גובה מופתה
      // לאותו שדה אחד.
      hEntries.push({idx:s.idx, mm:hs.h1, ax:(P[0][0]+P[3][0])/2, y1:P[0][1], y2:P[3][1], face:'L', field:'slopeH1'});
      hEntries.push({idx:s.idx, mm:hs.h2, ax:(P[1][0]+P[2][0])/2, y1:P[1][1], y2:P[2][1], face:'R', field:'slopeH2'});
    } else {
      hEntries.push({idx:s.idx, mm:s.mmH, ax:s.x+s.w/2, y1:s.y, y2:s.y+s.h, field:'h'});
    }
  });
  // ── איפה נרשם כל גובה ──
  //
  // קודם כל הגבהים נערמו בצד שמאל: 2000 ו-1985 בטור אחד, והקורא נשאר
  // לפענח לבד לאיזה פאנל שייך כל מספר — בזמן שהשוליים מימין ריקים.
  //
  // **כל קצה של ההרכבה נושא את הגובה של הפאנל שיושב בו.** פאנל שאין לו
  // קצה — דלת באמצע — נושא את הגובה שלו בתוך הזכוכית שלו. ככה כל מספר
  // נוגע במה שהוא מתאר, ואף אחד לא צריך קו הפניה.
  const nS=out.shapes.length;
  const entriesOf=i=>hEntries.filter(e=>e.idx===i);
  const uniform = hEntries.length>0 && hEntries.every(e=>e.mm===hEntries[0].mm);

  const hDims=[];
  if(uniform){
    // אין מה להבדיל — מספר אחד אומר את הכל
    hDims.push({mm:hEntries[0].mm, pts:hEntries, side:'left'});
  } else {
    const mids=[];
    hEntries.forEach(e=>{
      if(e.face){
        // פאה של שיפוע — המידה צמודה לפאה שלה, תמיד.
        //
        // ניסיון קודם שלח את שתי מידות החיתוך של דלת משופעת לשוליים
        // החיצוניים, אחת לכל צד. שם הן נקראו כאילו הן שייכות לקבועים
        // שמשני הצדדים, ושום דבר לא קשר אותן לדלת. פאה שהיא קצה חיצוני
        // — המידה יוצאת החוצה; פאה פנימית — המידה נכנסת **לתוך הזכוכית
        // של אותו שייף**, וכך רואים מיד לאיזו דלת היא שייכת.
        // "קצה חיצוני" נקבע לפי מקומו של השייף ברצף, לא לפי השוואת x.
        // פאה משופעת נוטה, ה-ax שלה הוא אמצע הנטייה, וההשוואה ל-asmL
        // נכשלה — הקצה השמאלי של הציור סווג כפאה פנימית ונשלח לתוך
        // הזכוכית, היישר אל המידה שבאה מהצד השני.
        const atL=(e.idx===0 && e.face==='L');
        const atR=(nS>0 && e.idx===nS-1 && e.face==='R');
        const dir = atL ? -1 : atR ? 1 : (e.face==='L' ? 1 : -1);
        hDims.push({mm:e.mm, pts:[e], side:'face', at:e.ax, dir:dir});
      }
      else if(e.idx===0)             hDims.push({mm:e.mm, pts:[e], side:'left'});
      else if(nS>1 && e.idx===nS-1)  hDims.push({mm:e.mm, pts:[e], side:'right'});
      else {
        // שייפים אמצעיים: כל גובה ייחודי פעם אחת. שתי דלתות באותו גובה
        // הן מידה אחת, לא שתיים.
        const g=mids.find(m=>m.mm===e.mm);
        if(g) g.pts.push(e); else mids.push({mm:e.mm, pts:[e]});
      }
    });
    mids.forEach(m=>hDims.push({mm:m.mm, pts:m.pts, side:'inside'}));
  }

  // הקצוות נרשמים כאן; מידה שיושבת **בתוך** פאנל נרשמת אחרי הפרזול,
  // כי היא חולקת איתו את אותה זכוכית וצריכה לראות איפה הוא נחת.
  const emitHeight=hd=>{
    const top=Math.min.apply(null,hd.pts.map(p=>p.y1));
    const bot=Math.max.apply(null,hd.pts.map(p=>p.y2));
    const idxs=hd.pts.map(p=>p.idx);
    let x, near, t=0.5, size=LG_SZ_MAIN;
    if(hd.side==='face'){
      // מידת פאה של שיפוע — גופן משני, כדי שהיא ומידות הצירים יחלקו
      // את אותם 46 פיקסלים בלי שאף אחת מהן תיאלץ להתרחק
      near=hd.at; size=LG_SZ_SUB;
      const bF = hd.dir>0 ? [near,near+MAX_NEAR] : [near-MAX_NEAR,near];
      x=placeV(near+hd.dir*cfg.subFirst, hd.dir*cfg.sub, top-13, bot+13, LG_SZ_SUB, bF);
    } else if(hd.side==='inside'){
      // פאנל שאין לו קצה. המידה יושבת על אחת הפאות שלו ולא באמצעו:
      // באמצע דלת של 69 פיקסלים כבר יושבים הציר, הידית ומרחק הידית,
      // ומידה שנדחפת משם החוצה מפסיקה להיראות שייכת לדלת.
      //
      // הפאה הנבחרת היא זו שאין בה פרזול — שתי דלתות שנפגשות נפגשות
      // ידית מול ידית, ושם הזכוכית פנויה.
      const s0=out.shapes[hd.pts[0].idx];
      const freeR=!(js[s0.idx+1]&&js[s0.idx+1].type);
      const freeL=!(js[s0.idx]&&js[s0.idx].type);
      const useR=!freeR||freeL, dir=useR?-1:1;
      near=useR ? s0.x+s0.w : s0.x;
      size=LG_SZ_SUB;
      const bI = dir>0 ? [near,near+MAX_NEAR] : [near-MAX_NEAR,near];
      x=placeV(near+dir*cfg.subFirst, dir*cfg.sub, top-13, bot+13, size, bI);
    } else {
      // הגובה הכללי נשאר **מחוץ** להרכבה. הפרזול תפס כבר את הנתיבים
      // שבתוך הזכוכית, ובלי החסם הזה הגובה היה נדחף פנימה ומתחלף איתם
      // במקום — הגדול קרוב והקטן רחוק, הפוך מכל שרטוט.
      const right=hd.side==='right', s=right?1:-1;
      near=right?asmR:asmL;
      const bound = right ? [near, near+MAX_NEAR] : [near-MAX_NEAR, near];
      x=placeV(near+s*cfg.first, s*cfg.step, top-13, bot+13, LG_SZ_MAIN, bound);
    }
    dim('height',hd.mm,x,top,x,bot,
        {zone:hd.side, idxs:idxs, idx:idxs[0], t:t, near:near, size:size,
         field:hd.pts[0].field||'h', inside:hd.side==='inside'});
  };
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
    // בקצה ההרכבה החוץ שמור לגובה — הוא המידה הראשית ומקומו בשוליים —
    // והפרזול נכנס פנימה. בלי החלוקה הזאת שניהם יצאו לאותו צד ודחפו זה
    // את זה ארבעה נתיבים החוצה.
    // הכיוון נקבע ע"י הזכוכית שהמידה מודדת, לא ע"י המקום הפנוי
    const dir = p.side!=null ? p.side : (roomR>roomL?1:-1);
    const room=Math.max(dir>0?roomR:roomL,0);

    // תווית מסובבת ארוכה מקו של 20 ס"מ בקנה מידה של פלאפון, ולכן היא
    // יוצאת מעבר לקצה. **פנימה, לתוך הזכוכית** — הקצה שליד הפרזול.
    // כלפי חוץ היא נדחפה מעל ראש הפאנל ונחתה על מידות הרוחב; פנימה היא
    // יושבת ליד הציר שהיא מתארת, וההיסט האופקי כבר מפנה את הסמל.
    const len=Math.abs(p.b-p.a);
    const need=Math.max(String(p.mm).length*LG_SZ_SUB*0.64+8, LG_SZ_SUB*2.2);
    let t=0.5;
    if(len<need+6){
      const over=(need/2+5)/Math.max(len,1);
      t = p.outward==='start' ? 1+over : -over;
    }
    const my=p.a+(p.b-p.a)*t;
    const lo=Math.min(p.a,p.b,my-need/2), hi=Math.max(p.a,p.b,my+need/2);

    // ההקצאה חייבת לראות גם את ה-x. מידת ציר יוצאת ימינה מפאה אחת
    // ומידת ידית שמאלה מפאה אחרת, והשתיים נפגשות באמצע — טווחי ה-y
    // שלהן חופפים אבל הפאות שונות, ולכן הקצאה שמסתכלת רק על y נתנה
    // לשתיהן את הנתיב הראשון והתוויות נחתו זו על זו.
    //
    // אין יציאה לשוליים. מידה שנדחפה החוצה מפסיקה לתאר את מה שהיא
    // מודדת, ולכן היא נשארת ליד הפאה — הגופן הקטן והנתיבים הצפופים הם
    // מה שקונה לה את המקום.
    // המרווח המינימלי נגזר מהסמל: רדיוס 9 ועוד חצי תווית משנית. פחות
    // מזה, והמספר נוחת על הציר שהוא מתאר.
    // ISO 129 — הקטן קרוב לזכוכית והגדול רחוק ממנה. מידת פרזול בקצה
    // ההרכבה נשארת בתוך הזכוכית, והגובה הכללי יוצא מחוצה לה.
    const atEdge = Math.abs(p.face-asmL)<0.5 || Math.abs(p.face-asmR)<0.5;
    const bound = !atEdge ? null
      : (dir>0 ? [p.face, p.face+MAX_NEAR] : [p.face-MAX_NEAR, p.face]);
    const gap=Math.max(9+LG_HALF(LG_SZ_SUB),Math.min(HW_GAP,room/2));
    const x=placeV(p.face+dir*gap,dir*cfg.sub,lo,hi,LG_SZ_SUB,bound);

    dim(p.kind,p.mm,x,p.a,x,p.b,
        {idx:p.idx, idxs:p.idxs, zone:'hw', face:p.face, near:p.face,
         size:LG_SZ_SUB, t:t});
  });

  hDims.filter(h=>h.side!=='inside').forEach(emitHeight);

  hDims.filter(h=>h.side==='inside').forEach(emitHeight);

  // ── גובה הפינוי ──
  //
  // חיצוני על הפאה, ופנימי על הפאה האנכית של הפינוי. כשהמדף ישר השניים
  // שווים ומספר אחד מספיק; כשהוא יורד, שתי המידות הן מה שמראה את זה.
  notchPend.forEach(p=>{
    const nt=p.nt, S=nt.shoulder, N=nt.inner, botY=p.botY;
    const bnd=(x,d)=>d>0?[x,x+MAX_NEAR]:[x-MAX_NEAR,x];
    const dirOut = p.right?-1:1;           // פנימה, לתוך הזכוכית
    const xOut=placeV(S[0]+dirOut*cfg.subFirst, dirOut*cfg.sub, S[1]-13, botY+13,
                      LG_SZ_SUB, bnd(S[0],dirOut));
    dim('notch-h',nt.h,xOut,S[1],xOut,botY,
        {idx:p.idx,zone:'notch',near:S[0],size:LG_SZ_SUB});
    // מדף נוטה מקבל שתי מידות גם כששני הגבהים שווים. הנטייה יכולה לבוא
    // מהרצפה ולא מהמדרגה, ואז העין רואה שיפוע ומוצא מספר אחד — בדיוק
    // המצב שבו לא ברור אם המדף ישר או לא.
    if(Math.abs(S[1]-N[1])>1){
      // גם היא פנימה, לתוך הזכוכית. כיוון הפוך הפנה אותה אל חלל הפינוי
      // הצר — היישר אל המידה החיצונית שבאה משם.
      const dirIn = dirOut;
      const xIn=placeV(N[0]+dirIn*cfg.subFirst, dirIn*cfg.sub, N[1]-13, botY+13,
                       LG_SZ_SUB, bnd(N[0],dirIn));
      dim('notch-h',nt.hIn,xIn,N[1],xIn,botY,
          {idx:p.idx,zone:'notch',near:N[0],size:LG_SZ_SUB});
    }
  });

  // ── מרחק החור מהפאה, אחרון ──
  //
  // 6 ס"מ הם ארבעה פיקסלים על מסך פלאפון והמספר רחב עשרים ושניים, ולכן
  // קו המידה עבר בדיוק דרך הספרות והן נבלעו. המספר יורד מהקצה החוצה,
  // והמידה כולה יורדת מתחת לחור עד שהיא מוצאת שורה פנויה — שתי דלתות
  // שנפגשות מביאות שתי ידיות זו מול זו, ושתי המידות רצו לאותו מקום.
  // מרחק החור מהפאה, ומרחק הזווית מהפאה — שתיהן מידות אופקיות קצרות
  // שמחפשות שורה פנויה מתחת למה שהן מתארות.
  const shortH=(kind,p,dirRight)=>{
    const need=Math.max(String(p.mm).length*LG_SZ_SUB*0.64+8, LG_SZ_SUB*2.2);
    const len=Math.abs(p.b-p.a);
    let t=0.5;
    if(len<need+4){
      const over=(need/2+5)/Math.max(len,1);
      t = dirRight ? 1+over : -over;     // כלפי הפאה והלאה
    }
    const lane=cfg.first+14;
    let k=0, y=p.y+lane;
    while(k<12 && !labelClear(labelBox(p.mm,0,p.a,y,p.b,y,t,LG_SZ_SUB)))
      y=p.y+lane+(++k)*16;
    dim(kind,p.mm,p.a,y,p.b,y,{idx:p.idx,zone:'handle',t:t,size:LG_SZ_SUB});
  };
  edgePend.forEach(p=>shortH('handle-edge',p,p.right));
  insetPend.forEach(p=>shortH('bracket-inset',p,p.into<0));

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
  let cW=o.canvasW||800;

  // ── רוחב מינימלי לציור ──
  //
  // מקלחון של חמישה פאנלים על מסך פלאפון נותן 225 פיקסלים של זכוכית,
  // ובתוכם צריכות לשבת שתים-עשרה מידות אנכיות. זו לא בעיית כיול: אין
  // מקום, ומשהו חייב לוותר — או שהמספרים מתרחקים מהזכוכית שהם מתארים,
  // או שהם נחתכים זה על זה.
  //
  // שניהם פסולים, ולכן מוותר הקנבס: כל פאנל מקבל את הרוחב שהמידות שלו
  // דורשות, והציור גדול מהמסך. שרטט מצייר גדול וגולל; הוא לא מקטין את
  // הסקיצה עד שאי אפשר לקרוא אותה. ‏canvas.w הוא מה שהצייר צריך לגלול.
  const shp=(shower&&shower.shapes)||[];
  if(shp.length>=2){
    // דלת נושאת גם חור וגם מרחק ידית; שייף משופע נושא שתי מידות חיתוך
    // במקום אחת. שניהם צריכים יותר זכוכית מקבוע רגיל.
    // כל תוספת גוררת עוד מידה אנכית על אותה זכוכית, וכשאין מקום המספר
    // או מתרחק או נחתך. שניהם פסולים, ולכן הציור גדל.
    const room=shp.reduce((n,s)=>n+110
      +((s&&s.kind)==='door'?15:0)
      +((s&&s.slopeH1)?35:0)+((s&&s.slopeW1)?25:0)
      +((s&&s.notchW)?140:0),0);      // פינוי מוסיף רוחב, גובה, ומה שנשאר
    const need=Math.round(room/0.65);
    if(need>cW) cW=need;
  }

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

// ─── ליקוט הזכוכית ───────────────────────────────────────────────────────
//
// ‏lgBOM מלקט את הפרזול. זה מלקט את מה שנחתך.
//
// **השטח נמדד לפי הגובה הגדול ביותר והרוחב הגדול ביותר** — המלבן
// החוסם. זה נכון גם לשיפוע וגם לפינוי, כי מהלוח נחתך מלבן ומה שיורד
// ממנו הולך לפח: משלמים על מה שקונים, לא על מה שנשאר.
//
// השטח נטו מוצג לצידו כמידע בלבד — הוא מראה כמה זכוכית באמת יוצאת,
// וההפרש ביניהם הוא הפחת.
function lgGlass(shower){
  const outs=lgOutline(shower);
  const js=(typeof lgJunctions==='function')?lgJunctions(shower):[];
  const shapes=(shower&&shower.shapes)||[];

  // שטח פוליגון — נוסחת שרוכי הנעל. פשוטה, מדויקת, ולא אכפת לה כמה
  // צלעות יש: מרובע, משופע, או שש-צלעות של פינוי.
  const thick=src=>Number(src.thickness || (shower&&shower.thickness)) || null;

  const area=P=>{ let a=0;
    for(let i=0,n=P.length;i<n;i++){ const b=P[(i+1)%n];
      a += P[i][0]*b[1] - b[0]*P[i][1]; }
    return Math.abs(a)/2; };

  return outs.map((o,i)=>{
    const src=shapes[i]||{};
    const grossMM2=o.mmW*o.mmH, netMM2=area(o.poly);
    const round2=v=>Math.round(v*100)/100;

    // קידוחים: חור לידית, וחור לכל פריט פרזול שנתלה על הזכוכית הזאת.
    // ציר נספר פעם אחת בצומת, אבל **קודח בשתי הזכוכיות** — לכן הוא
    // נספר כאן שוב, מצד הזכוכית.
    let holes = o.kind==='door' ? 1 : 0;
    [js[i],js[i+1]].forEach(j=>{ if(j&&j.type) holes += (j.qty||2); });

    return {
      idx:i, id:o.id, kind:o.kind, label:o.label,
      cutW:o.mmW, cutH:o.mmH,                  // הגדול ביותר בכל כיוון
      // הפחת נגזר מהמספרים המעוגלים ולא מהגולמיים, אחרת השורה בטבלה לא
      // מתחברת: 1.00 פחות 0.87 חייב להיות 0.13 גם על הנייר.
      m2:round2(grossMM2/1e6),                 // זה מה שמחייבים
      netM2:round2(netMM2/1e6),                // כמה זכוכית באמת יוצאת
      wasteM2:round2(round2(grossMM2/1e6)-round2(netMM2/1e6)),
      // העובי נבחר בזמן בניית השרטוט — לכל המקלחון, ואפשר לדרוס לזכוכית
      // בודדת. ממנו נגזר המשקל, וזה מה שקובע כמה אנשים צריך להרמה.
      thickness:thick(src),
      glassType:src.glassType || (shower&&shower.glassType) || null,
      kg:round2(grossMM2/1e6*(thick(src)||0)*LG_GLASS_KG),
      sloped:!!(o.slope&&(o.slope.hSide||o.slope.vSide)),
      notched:!!o.notch,
      shape: o.notch ? 'פינוי מדרגה'
           : (o.slope&&o.slope.hSide&&o.slope.vSide) ? 'משופע בגובה וברוחב'
           : (o.slope&&o.slope.hSide) ? 'משופע בגובה'
           : (o.slope&&o.slope.vSide) ? 'משופע ברוחב' : 'מלבן',
      holes:holes,
      poly:o.poly,
    };
  });
}

// סיכום להזמנה: כמה זכוכיות, כמה מ"ר, וכמה הולך לפח.
function lgGlassTotals(shower){
  const g=lgGlass(shower);
  const sum=(k)=>Math.round(g.reduce((n,x)=>n+x[k],0)*100)/100;
  return { panes:g.length, m2:sum('m2'), netM2:sum('netM2'),
           wasteM2:sum('wasteM2'), kg:sum('kg'),
           holes:g.reduce((n,x)=>n+x.holes,0),
           heaviest:g.reduce((m,x)=>Math.max(m,x.kg||0),0) };
}

// ─── שורות הזמנה ─────────────────────────────────────────────────────────
//
// המנוע גוזר **סוגים**, לא מק"טים. מק"ט בתוך המנוע היה קושר אותו לקטלוג
// של לקוח מסוים, וקבלן עם פרזול אחר היה מחייב שינוי במנוע.
//
// כאן שני הליקוטים מתאחדים לשורות עם **מפתח קטלוגי** — הצירוף שממנו
// נגזר המק"ט. המיפוי עצמו מגיע מבחוץ: המחירון של חשבשבת, טבלה במסד,
// או פונקציה. המנוע לא יודע מחירים ולא צריך לדעת.
//
//   lgOrderLines(shower, sku)  →  [{key, sku, qty, unit, ...}]
//
// ‏sku היא פונקציה אופציונלית שמקבלת מפתח ומחזירה מק"ט. בלעדיה השורות
// חוזרות עם המפתח בלבד — מספיק כדי להציג ליקוט, לא מספיק כדי לתמחר.
function lgOrderLines(shower,sku){
  const map = typeof sku==='function' ? sku : ()=>null;
  const out = [];

  // זכוכית: מקובצת לפי (סוג, עובי) ונמכרת במ"ר. שתי זכוכיות באותו סוג
  // ועובי הן שורה אחת בהזמנה, גם אם המידות שונות.
  const glass = {};
  lgGlass(shower).forEach(g=>{
    const key = { kind:'glass', glassType:g.glassType, thickness:g.thickness };
    const k = JSON.stringify(key);
    if(!glass[k]) glass[k] = { key:key, sku:map(key), qty:0, unit:'m2', panes:0, detail:[] };
    glass[k].qty += g.m2;
    glass[k].panes += 1;
    glass[k].detail.push({ id:g.id, cutW:g.cutW, cutH:g.cutH, m2:g.m2, shape:g.shape, holes:g.holes });
  });
  Object.keys(glass).forEach(k=>{
    glass[k].qty = Math.round(glass[k].qty*100)/100;
    out.push(glass[k]);
  });

  // פרזול: הצירוף שכבר יוצא מ-lgBOM הוא בדיוק המפתח הקטלוגי.
  const bom = (typeof lgBOM==='function') ? lgBOM(shower) : [];
  bom.forEach(l=>{
    const key = { kind:'hardware', type:l.type, variant:l.variant,
                  finish:l.finish, quality:l.quality };
    out.push({ key:key, sku:map(key), qty:l.qty, unit:'unit' });
  });

  return out;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { lgLayout, lgOutline, lgGlass, lgGlassTotals,
                     lgFromPanels, lgOrderLines };
