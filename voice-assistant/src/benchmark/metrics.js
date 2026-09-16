/**
 * מדדי איכות תמלול.
 *
 * אפיון, סעיף 24: "במערכת שלנו Semantic Accuracy חשובה יותר מ-Word Accuracy.
 * אם המערכת תמללה מילה אחת קצת שונה אבל הבינה נכון את התזכורת - זה יכול להיות
 * תקין. אבל אם היא הבינה 10:00 במקום 22:00 - זו שגיאה קריטית."
 *
 * לכן לא מספיק WER. המדדים כאן מופרדים בכוונה, ו-Date/Time נמדדים בנפרד
 * מהתוכן — כי הם אלה שקובעים אם תזכורת תצלצל בזמן הנכון.
 */

/**
 * נרמול לפני השוואה.
 *
 * מסירים ניקוד, גרשיים ופיסוק — הבדל של גרש אינו שגיאת תמלול אמיתית
 * מבחינת המשתמש. *לא* מאחדים אותיות סופיות: "כלב" ו"כלך" הן מילים שונות,
 * ואיחוד היה מסתיר שגיאות אמיתיות.
 */
export function normalizeHebrew (text) {
    return String(text || '')
        .replace(/[֑-ׇ]/g, '')       // טעמים וניקוד
        .replace(/[׳״'"`]/g, '')     // גרש, גרשיים
        .replace(/[.,!?;:()\[\]{}\-–—]/g, ' ') // פיסוק
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenize (text) {
    const normalized = normalizeHebrew(text);
    return normalized === '' ? [] : normalized.split(' ');
}

/**
 * מרחק עריכה ברמת מילים (Levenshtein).
 * שתי שורות בלבד בזיכרון — הקבצים קצרים, אבל אין סיבה להחזיק מטריצה מלאה.
 */
export function wordEditDistance (reference, hypothesis) {
    const ref = tokenize(reference);
    const hyp = tokenize(hypothesis);

    if (ref.length === 0) return { distance: hyp.length, refLength: 0 };
    if (hyp.length === 0) return { distance: ref.length, refLength: ref.length };

    let previous = Array.from({ length: hyp.length + 1 }, (_, i) => i);
    let current = new Array(hyp.length + 1);

    for (let i = 1; i <= ref.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= hyp.length; j += 1) {
            const substitutionCost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,                      // מחיקה
                current[j - 1] + 1,                   // הוספה
                previous[j - 1] + substitutionCost    // החלפה
            );
        }
        [previous, current] = [current, previous];
    }

    return { distance: previous[hyp.length], refLength: ref.length };
}

/** Word Error Rate. 0 = מושלם. יכול לעבור 1 כשהמנוע המציא מילים. */
export function wordErrorRate (reference, hypothesis) {
    const { distance, refLength } = wordEditDistance(reference, hypothesis);
    if (refLength === 0) return distance === 0 ? 0 : 1;
    return distance / refLength;
}

/**
 * האם הכוונה הובנה נכון — זה המדד שקובע אם המוצר שמיש.
 * שדה שלא הוגדר בציפייה אינו נבדק, כדי לאפשר ground truth חלקי.
 */
export function semanticMatch (expected, actual) {
    const checks = {};

    if (expected.type !== undefined) {
        checks.type = expected.type === actual.type;
    }

    if (expected.date !== undefined) {
        checks.date = (expected.date || null) === (actual.date || null);
    }

    if (expected.time !== undefined) {
        checks.time = (expected.time || null) === (actual.time || null);
    }

    if (expected.text !== undefined) {
        // תוכן הפתק נמדד בסובלנות: מילה שתומללה מעט שונה אינה שגיאה
        // סמנטית כל עוד המשמעות נשמרה. הסף נבחר שמרנית.
        checks.text = wordErrorRate(expected.text, actual.text || '') <= 0.34;
    }

    const values = Object.values(checks);
    return {
        checks,
        allPassed: values.length > 0 && values.every(Boolean),
        passedCount: values.filter(Boolean).length,
        totalCount: values.length
    };
}

/** אחוז עם ספרה אחת אחרי הנקודה, להצגה בטבלה. */
export function percent (value) {
    return `${(value * 100).toFixed(1)}%`;
}

export function mean (numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

/** חציון עמיד יותר מממוצע כשקריאה אחת נתקעה על timeout. */
export function median (numbers) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}
