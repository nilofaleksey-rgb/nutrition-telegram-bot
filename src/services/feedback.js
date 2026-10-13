import { getDB, saveDB } from '../database/db.js';

function rows(result) {
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

/** Сохраняем замечание пользователя. */
export async function addFeedback({ userId, message, context = 'general', targetId = null }) {
  const db = await getDB();
  db.run(
    `INSERT INTO feedback (user_id, context, target_id, message) VALUES (?, ?, ?, ?)`,
    [userId, context, targetId, message]
  );
  saveDB();
}

/** Последние замечания пользователя. */
export async function getFeedback(userId, limit = 20) {
  const db = await getDB();
  const result = db.exec(
    `SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
  return rows(result);
}

/** Последнее замечание — чтобы применить его к результату. */
export async function getLastFeedback(userId) {
  const db = await getDB();
  const result = db.exec(
    `SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  return rows(result)[0] || null;
}

export async function markFeedbackApplied(id) {
  const db = await getDB();
  db.run(`UPDATE feedback SET applied = 1 WHERE id = ?`, [id]);
  saveDB();
}

export async function deleteAllFeedback(userId) {
  const db = await getDB();
  db.run(`DELETE FROM feedback WHERE user_id = ?`, [userId]);
  saveDB();
}

/* ---------------- Долговременная память о пользователе ---------------- */

/** Запоминаем факт о пользователе (аллергия, предпочтения и т.п.). */
export async function addMemory(userId, note) {
  const db = await getDB();

  // Не дублируем одинаковые заметки
  const existing = db.exec(
    `SELECT id FROM user_memory WHERE user_id = ? AND lower(note) = lower(?)`,
    [userId, note]
  );
  if (existing.length && existing[0].values.length) return false;

  db.run(`INSERT INTO user_memory (user_id, note) VALUES (?, ?)`, [userId, note]);
  saveDB();
  return true;
}

export async function getMemory(userId, limit = 30) {
  const db = await getDB();
  const result = db.exec(
    `SELECT * FROM user_memory WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
  return rows(result);
}

export async function deleteMemory(userId, id = null) {
  const db = await getDB();
  if (id) db.run(`DELETE FROM user_memory WHERE user_id = ? AND id = ?`, [userId, id]);
  else db.run(`DELETE FROM user_memory WHERE user_id = ?`, [userId]);
  saveDB();
}

/** Строка с памятью и замечаниями — вставляется в промпт для AI. */
export async function getPersonalContext(userId) {
  const [memory, feedback] = await Promise.all([getMemory(userId, 20), getFeedback(userId, 10)]);

  const parts = [];
  if (memory.length) {
    parts.push(`Что известно о пользователе (обязательно учитывай это):\n${memory.map(m => `- ${m.note}`).join('\n')}`);
  }
  if (feedback.length) {
    parts.push(`Последние замечания пользователя к прошлым ответам:\n${feedback.map(f => `- ${f.message}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Достаёт из памяти список запрещённых продуктов/ингредиентов.
 * Нужен для детерминированной проверки ответа бота.
 */
export async function getForbiddenFoods(userId) {
  const memory = await getMemory(userId, 30);
  const forbidden = new Set();

  const KNOWN = [
    'свинин', 'говядин', 'куриц', 'кури', 'индейк', 'рыб', 'лосос', 'тунец', 'минтай',
    'морепродукт', 'креветк', 'яйц', 'яйцо', 'молок', 'творог', 'сыр', 'кефир', 'йогурт',
    'лактоз', 'глютен', 'орех', 'арахис', 'миндал', 'гречк', 'рисов', 'пшениц', 'хлеб',
    'макарон', 'сахар', 'мед', 'банан', 'цитрус', 'апельсин', 'соя', 'бобов', 'фасол',
    'гриб', 'лук', 'чеснок', 'помидор', 'картоф', 'баклажан', 'свинину', 'алкогол'
  ];

  for (const note of memory) {
    const lower = String(note.note || '').toLowerCase();

    // Заметка должна выражать запрет
    if (!/(не\s+ем|не\s+люблю|нельзя|исключ|аллерг|не\s+перенош|непереносимост|без\s+|отказ|не\s+употребля)/i.test(lower)) {
      continue;
    }

    for (const food of KNOWN) {
      if (lower.includes(food)) {
        // Нормализуем до корня
        forbidden.add(food.replace(/у$/, '').replace(/(ин|иц|к|ь)$/, '') || food);
      }
    }

    // Специальный случай: лактоза/глютен → связанные продукты
    if (/лактоз/i.test(lower)) ['молок', 'творог', 'сыр', 'кефир', 'йогурт'].forEach(f => forbidden.add(f));
    if (/глютен/i.test(lower)) ['пшениц', 'хлеб', 'макарон', 'батон'].forEach(f => forbidden.add(f));
  }

  return [...forbidden];
}

/**
 * Проверяет ответ бота на запрещённые продукты.
 * Возвращает список нарушений (пусто = всё хорошо).
 */
export function findViolations(text, forbiddenFoods) {
  if (!text || !forbiddenFoods?.length) return [];

  const lower = String(text).toLowerCase();
  const violations = [];

  // Фразы, которые означают, что продукт НЕ рекомендуется — это не нарушение
  const negations = [
    'не ем', 'не едим', 'не употребля', 'избега', 'исключ', 'без ', 'табу',
    'вместо', 'замен', 'не рекоменд', 'аллерг', 'убрать', 'нельзя'
  ];

  for (const food of forbiddenFoods) {
    const regex = new RegExp(food, 'gi');
    let match;

    while ((match = regex.exec(lower)) !== null) {
      // Смотрим контекст вокруг упоминания (±60 символов)
      const start = Math.max(0, match.index - 60);
      const end = Math.min(lower.length, match.index + match[0].length + 60);
      const context = lower.slice(start, end);

      const isNegated = negations.some(n => context.includes(n));

      // «вместо свинины — индейка» это корректно, «свинина на ужин» — нарушение
      if (!isNegated) {
        violations.push({ food, context: context.trim().slice(0, 100) });
      }
    }
  }

  return violations;
}

/**
 * Обёртка над консультацией с гарантией соблюдения ограничений.
 * Если модель предложила запрещённый продукт — повторяем запрос
 * с жёстким указанием и, при повторной неудаче, чистим ответ.
 *
 * getConsultationFn передаётся снаружи, чтобы не создавать цикл импортов.
 */
export async function getSafeConsultation({
  question,
  profile,
  todayStats,
  userId,
  getConsultationFn
}) {
  const personalContext = await getPersonalContext(userId);
  const forbidden = await getForbiddenFoods(userId);

  let response = await getConsultationFn({ question, profile, todayStats, personalContext });
  let violations = findViolations(`${response.short} ${response.detailed}`, forbidden);

  if (violations.length) {
    console.warn(`⚠️ Ограничения нарушены (${violations.map(v => v.food).join(', ')}) — переспрашиваю модель`);

    const strictContext = `${personalContext}

КРИТИЧНО: в прошлом ответе ты ошибочно упомянул(а): ${violations.map(v => v.food).join(', ')}.
Это СТРОГО ЗАПРЕЩЕНО. Построй ответ так, чтобы этих продуктов не было вообще — ни в рекомендациях, ни в примерах.`;

    const retry = await getConsultationFn({ question, profile, todayStats, personalContext: strictContext });
    const retryViolations = findViolations(`${retry.short} ${retry.detailed}`, forbidden);

    if (retryViolations.length === 0) {
      return { response: retry, violations: [] };
    }

    // Модель упорно нарушает — подчищаем текст вручную
    console.warn('⚠️ Повторное нарушение — чищу ответ вручную');
    const cleaned = cleanResponse(retry, forbidden);
    const cleanedViolations = findViolations(`${cleaned.short} ${cleaned.detailed}`, forbidden);

    return { response: cleaned, violations: cleanedViolations };
  }

  return { response, violations: [] };
}

/** Убирает запрещённые продукты из текста ответа (и краткого, и подробного). */
function cleanResponse(response, forbiddenFoods) {
  const dropOffendingSentences = (text) => {
    let result = String(text || '');
    for (const food of forbiddenFoods) {
      result = result
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          const hasFood = new RegExp(food, 'i').test(sentence);
          if (!hasFood) return true;
          // Оставляем предложения, где продукт упомянут как запрещённый
          return /(не ем|не едим|избега|исключ|без |табу|вместо|замен|аллерг|нельзя|не рекоменд)/i.test(sentence);
        })
        .join(' ');
    }
    return result.trim();
  };

  const short = dropOffendingSentences(response.short);
  const detailed = dropOffendingSentences(response.detailed);

  const note = forbiddenFoods.length
    ? `\n\n⚠️ Учитываю твои ограничения и не рекомендую: ${forbiddenFoods.join(', ')}.`
    : '';

  // Если краткий ответ целиком состоял из запрещённых продуктов — заменяем безопасной фразой
  const safeShort = short && findViolations(short, forbiddenFoods).length === 0
    ? short
    : '💡 Подберу вариант с учётом твоих ограничений — уточни, какие продукты тебе подходят, и я составлю меню.';

  const safeDetailed = detailed || 'Учитываю твои ограничения по питанию. Расскажи, какие продукты тебе подходят, и я составлю подробный план.';

  return {
    short: safeShort,
    detailed: safeDetailed + note
  };
}