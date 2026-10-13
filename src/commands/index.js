import { Markup } from 'telegraf';
import { getDailyStats, getPeriodStats } from '../services/stats.js';
import { progressBar } from '../handlers/diary.js';
import { setupProfileHandler } from '../handlers/profile.js';
import { setupDiaryHandler } from '../handlers/diary.js';
import { setupWeightHandler } from '../handlers/weight.js';
import { setupConsultationHandler } from '../handlers/consultation.js';
import { aiStatus } from '../services/ai.js';

export const MAIN_KEYBOARD = Markup.keyboard([
  ['📝 Заполнить профиль', '👤 Мой профиль'],
  ['📊 Дневник питания', '📸 Анализ еды'],
  ['⚖️ Замер веса', '🩺 Загрузить анализы'],
  ['💬 Консультация', '📈 Отчеты']
]).resize();

export function setupCommands(bot) {
  bot.start(async (ctx) => {
    await ctx.reply(
      '👋 Привет! Я твой ИИ-ассистент по питанию 🍎\n\n' +
      'Нутрициолог, диетолог и фитнес-тренер с 10-летним опытом в одном боте.\n\n' +
      'Что я умею:\n' +
      '🎯 Вести к цели по весу\n' +
      '📝 Считать КБЖУ за день\n' +
      '📸 Анализировать еду по фото\n' +
      '🎤 Принимать еду голосом\n' +
      '⚖️ Следить за замерами веса\n' +
      '🩺 Разбирать анализы и давать рекомендации\n' +
      '📈 Показывать отчёты\n\n' +
      'Давай начнём с профиля — нажми «📝 Заполнить профиль» 👇',
      MAIN_KEYBOARD
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      '🤖 Команды:\n\n' +
      '/start — начать\n' +
      '/profile — заполнить профиль\n' +
      '/diary — дневник питания на сегодня\n' +
      '/stats — КБЖУ за сегодня\n' +
      '/weight — записать вес\n' +
      '/report — отчёт за неделю\n' +
      '/analyses — как загрузить анализы\n' +
      '/ask — задать вопрос диетологу\n' +
      '/status — состояние бота\n' +
      '/help — эта справка\n\n' +
      '📸 Отправь фото еды — посчитаю КБЖУ\n' +
      '🎤 Отправь голосовое — распознаю и запишу\n' +
      '✍️ Напиши «гречка с курицей 250 г» — тоже запишу\n\n' +
      '💡 После ответа напиши «дай более развернутый ответ» — распишу подробнее.'
    );
  });

  bot.command('profile', (ctx) => setupProfileHandler(ctx));
  bot.command('diary', (ctx) => setupDiaryHandler(ctx));
  bot.command('weight', (ctx) => setupWeightHandler(ctx));
  bot.command('ask', (ctx) => setupConsultationHandler(ctx));

  bot.command('analyses', (ctx) =>
    ctx.reply(
      '🩺 Как загрузить анализы:\n\n' +
      '1. Нажми «🩺 Загрузить анализы»\n' +
      '2. Отправь скриншот анализов как ФОТО\n\n' +
      'Я разберу показатели, дам рекомендации по питанию и сравню с предыдущими анализами.\n\n' +
      '⚠️ Это не заменяет консультацию врача.'
    )
  );

  bot.command('stats', async (ctx) => {
    const stats = await getDailyStats(ctx.from.id, new Date().toISOString().split('T')[0]);
    if (!stats) return ctx.reply('📊 Сегодня ещё нет записей. Добавь приём пищи!');

    const remaining = stats.dailyCalories - stats.calories;
    await ctx.reply(
      `📊 Статистика за сегодня:\n\n` +
      `🔥 Калории: ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n` +
      `${progressBar(stats.calories, stats.dailyCalories)}\n\n` +
      `🥩 Белки: ${stats.protein.toFixed(1)} / ${stats.dailyProtein} г\n` +
      `🧈 Жиры: ${stats.fats.toFixed(1)} / ${stats.dailyFats} г\n` +
      `🍞 Углеводы: ${stats.carbs.toFixed(1)} / ${stats.dailyCarbs} г\n\n` +
      (remaining > 0
        ? `💡 Осталось: ${remaining.toFixed(0)} ккал`
        : `⚠️ Превышение: ${Math.abs(remaining).toFixed(0)} ккал`)
    );
  });

  bot.command('report', async (ctx) => {
    const days = 7;
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

    const rows = await getPeriodStats(ctx.from.id, startDate, endDate);

    if (!rows.length) {
      return ctx.reply('📈 За последнюю неделю нет записей. Начни вести дневник!');
    }

    let message = `📈 Отчёт за последние ${days} дней:\n\n`;
    let totalCalories = 0;
    let totalProtein = 0;

    for (const row of rows) {
      const date = new Date(row.date).toLocaleDateString('ru-RU');
      message += `${date}: ${Number(row.calories).toFixed(0)} ккал (Б ${Number(row.protein).toFixed(0)} / Ж ${Number(row.fats).toFixed(0)} / У ${Number(row.carbs).toFixed(0)})\n`;
      totalCalories += Number(row.calories) || 0;
      totalProtein += Number(row.protein) || 0;
    }

    message += `\n📊 В среднем за день: ${(totalCalories / rows.length).toFixed(0)} ккал, белка ${(totalProtein / rows.length).toFixed(1)} г`;
    message += `\n📅 Дней с записями: ${rows.length} из ${days}`;

    await ctx.reply(message);
  });

  bot.command('reset', async (ctx) => {
    ctx.session = {};
    await ctx.reply('🔄 Диалог сброшен. Что делаем дальше?', MAIN_KEYBOARD);
  });

  bot.command('status', async (ctx) => {
    const ai = aiStatus();
    await ctx.reply(
      `⚙️ Состояние бота:\n\n` +
      `🧠 Умные ответы (Gemini): ${ai.gemini ? '✅' : '⚠️ нет ключа'}\n` +
      `📸 Распознавание фото: ${ai.vision ? '✅' : '⚠️ нет ключа'}\n` +
      `🎤 Распознавание голоса: ${ai.voice ? '✅' : '⚠️ нет ключа'}\n` +
      `✍️ Текстовый AI без ключа: ✅\n` +
      `📚 Локальная база продуктов: ✅`
    );
  });
}