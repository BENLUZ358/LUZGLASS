// סרטונים 07/08 — איך מוסיפים את LuzGlass למסך הבית (בן, 24/11). טלפון מצויר: tools/training-video/mock/home-screen.html
import { CLOCK, users } from '../lib/seedlib.js';

export const homeSeed = () => ({ __clock: CLOCK, __session: '0500000000', db: { users: users() } });

export function homeScript(os) {
  const ios = os === 'ios';
  return async function script(r) {
    r.card({ kind: 'title', title: 'LuzGlass במסך הבית', sub: ios ? 'אייפון · ספארי' : 'גלקסי · כרום',
      bullets: ['אייקון של LuzGlass על המסך, כמו אפליקציה', 'לוחצים עליו — והפורטל נפתח מיד', 'לוקח פחות מדקה'] });
    await r.open('tools/training-video/mock/home-screen.html?os=' + os, { wait: '.phone' });
    await r.show({ focus: '.phone', mark: ios ? '.ios-url' : '.ch-url',
      text: ios ? 'פותחים את **luzglass.vercel.app** בדפדפן **ספארי** (לא בכרום — באייפון זה עובד רק בספארי).'
                : 'פותחים את **luzglass.vercel.app** בדפדפן **כרום**.', hold: 5 });
    if (ios) {
      await r.click({ target: '#share', focus: '.phone', text: 'למטה לוחצים על כפתור **השיתוף** — הריבוע עם החץ למעלה ⬆︎.',
        after: 'נפתחת רשימה. גוללים בה קצת למטה.', afterMark: '.sheet' });
      await r.click({ target: '#addHome', focus: '.phone', text: 'לוחצים על **"הוסף למסך הבית"**.',
        after: 'רואים את האייקון של LuzGlass ואת השם.', afterMark: '.addscr .card' });
      await r.click({ target: '#addBtn', focus: '.phone', text: 'לוחצים **"הוסף"** בפינה למעלה.',
        after: 'זהו! האייקון של **LuzGlass** נמצא עכשיו במסך הבית.', afterMark: '#newApp', hold: 5 });
    } else {
      await r.click({ target: '#dots', focus: '.phone', text: 'למעלה, ליד הכתובת, לוחצים על **שלוש הנקודות ⋮**.',
        after: 'נפתח תפריט.', afterMark: '.menu' });
      await r.click({ target: '#addHome', focus: '.phone', text: 'לוחצים **"הוספה למסך הבית"**. (בחלק מהטלפונים כתוב **"התקנת האפליקציה"** — זה אותו דבר.)',
        after: 'נפתח חלון קטן עם האייקון של LuzGlass.', afterMark: '.dlg' });
      await r.click({ target: '#addBtn', focus: '.phone', text: 'לוחצים **"הוספה"** (או "התקנה").',
        after: 'זהו! האייקון של **LuzGlass** נמצא עכשיו במסך הבית.', afterMark: '#newApp', hold: 5 });
    }
    r.card({ title: 'מעכשיו', bullets: ['לוחצים על האייקון **LuzGlass** — והפורטל נפתח', 'בפעם הראשונה נכנסים עם **מספר הטלפון והסיסמה**', 'שכחת סיסמה? כתוב לנו בוואטסאפ'] });
  };
}
