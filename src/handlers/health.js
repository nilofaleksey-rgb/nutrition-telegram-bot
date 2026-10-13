import { analyzeHealthTests, hasGemini } from '../services/ai.js';
import { getDB, saveDB } from '../database/db.js';
import { downloadTelegramFile } from './photo.js';

/** Сохраняет анализ в БД. */
async function saveAnalysis(userId, data, date) {
  const db = await getDB();
  db.run(
    `INSERT INTO health_analyses (user_id, analysis_data, recommendations, date)
     VALUES (?, ?, ?, ?)`,
    [userId, JSON.stringify(data.analysis || ''), JSON.stringify(data.recommendations || ''), date]
  );
  saveDB();
}

/** Берёт предыдущие анализы пользователя для сравнения. */
async function getPreviousAnalyses(userId, limit = 3) {
  const db = await getDB();
  const result = db.exec(
    `SELECT analysis_data, date FROM health_analyses
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT ?`,
    [userId, limit]
  );

  if (!result.length) return [];

  return result[0].values.map(([data, date]) => {
    let parsed = data;
    try { parsed = JSON.parse(data); } catch {}
    return { date, показатели: parsed };
  });
}

export function setupHealthHandler(bot) {
  // Отдельного action не требуется — обработка идёт из bot.on('photo')
}

/** Вызывается, когда пользователь прислал фото анализов (через кнопку «🩺 Загрузить анализы»). */
export async function handleHealthPhoto(ctx, buffer, mimeType) {
  if (!hasGemini()) {
    await ctx.reply(
      '🩺 Для анализа медицинских показателей нужен бесплатный ключ Google Gemini.\n\n' +
      'Получи его: https://aistudio.google.com/apikey\n' +
      'Затем добавь переменную:\nGEMINI_API_KEY=твой_ключ'
    );
    return;
  }

  const loading = await ctx.reply('🩺 Анализирую показатели...');

  try {
    const previous = await getPreviousAnalyses(ctx.from.id);
    const result = await analyzeHealthTests(buffer, mimeType, previous);

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (!result) {
      return ctx.reply('❌ Не удалось распознать анализы. Попробуй более чёткий скриншот.');
    }

    const today = new Date().toISOString().split('T')[0];
    await saveAnalysis(ctx.from.id, result, today);

    let message = '🩺 Анализ результатов:\n\n';
    if (result.analysis) message += `📋 Показатели:\n${result.analysis}\n\n`;
    if (result.recommendations) message += `💡 Рекомендации по питанию:\n${result.recommendations}\n\n`;
    if (result.comparison) message += `📈 Динамика:\n${result.comparison}\n\n`;
    message += '⚠️ Это не заменяет консультацию врача.';

    await ctx.reply(message);
  } catch (error) {
    console.error('Ошибка анализа анализов:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('❌ Произошла ошибка при анализе. Попробуй ещё раз.');
  }
}