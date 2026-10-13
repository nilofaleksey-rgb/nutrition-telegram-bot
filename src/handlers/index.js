import { Markup } from 'telegraf';
import { setupProfileHandler, setupGenderCallback, handleProfileText } from './profile.js';
import { setupDiaryHandler, setupAddMealCallback, setupMealTimeCallback, setupEditDiaryCallback } from './diary.js';
import { setupPhotoHandler, setupSaveMealCallback, formatFoodCard, mealKeyboard } from './photo.js';
import { setupVoiceHandler } from './voice.js';
import { setupWeightHandler, setupWeightHistoryCallback, handleWeightText } from './weight.js';
import { setupConsultationHandler } from './consultation.js';
import { setupHealthHandler } from './health.js';
import { getUserProfile } from '../services/user.js';
import { getDailyStats } from '../services/stats.js';
import { extractFoodFromText } from '../services/ai.js';

/** Похоже ли сообщение на описание еды. */
function looksLikeFood(text) {
  const lower = text.toLowerCase();
  const verbs = /(съел|съела|поел|поела|перекусил|перекусила|выпил|выпила|на завтрак|на обед|на ужин|порция|тарелка)/;
  const weights = /\d+\s*(г|гр|грамм|шт)\b/;
  const products = /(каша|гречка|рис|курица|рыба|мясо|суп|борщ|салат|яйц|творог|хлеб|банан|яблоко|кофе|чай|пицца|бургер|паста|макароны|картош|овсянк|омлет|кефир|йогурт|сыр|индейк|говядин|свинин|лосос|тунец|минтай|брокколи|огур|помидор|капуст|морков)/;
  return verbs.test(lower) || weights.test(lower) || products.test(lower);
}

export function setupHandlers(bot) {
  // Callback-обработчики
  setupGenderCallback(bot);
  setupAddMealCallback(bot);
  setupMealTimeCallback(bot);
  setupEditDiaryCallback(bot);
  setupSaveMealCallback(bot);
  setupWeightHistoryCallback(bot);
  setupHealthHandler(bot);

  // ---- Главное меню ----
  bot.hears('📝 Заполнить профиль', (ctx) => setupProfileHandler(ctx));

  bot.hears('👤 Мой профиль', async (ctx) => {
    const profile = await getUserProfile(ctx.from.id);
    if (!profile) {
      return ctx.reply('Сначала заполни профиль! Нажми «📝 Заполнить профиль»');
    }
    await ctx.reply(
      `👤 Твой профиль:\n\n` +
      `📏 Рост: ${profile.height} см\n` +
      `⚖️ Текущий вес: ${profile.weight} кг\n` +
      `🎯 Целевой вес: ${profile.goal_weight} кг\n` +
      `👤 Пол: ${profile.gender === 'male' ? 'Мужской' : 'Женский'}\n` +
      `🎂 Возраст: ${profile.age} лет\n\n` +
      `📊 Дневная норма:\n` +
      `🔥 ${profile.daily_calories} ккал\n` +
      `🥩 Белки: ${profile.daily_protein} г\n` +
      `🧈 Жиры: ${profile.daily_fats} г\n` +
      `🍞 Углеводы: ${profile.daily_carbs} г`
    );
  });

  bot.hears('📊 Дневник питания', (ctx) => setupDiaryHandler(ctx));

  bot.hears('📸 Анализ еды', (ctx) =>
    ctx.reply(
      '📸 Отправь фото блюда — посчитаю КБЖУ\n' +
      '✍️ Или напиши текстом: «гречка с курицей 250 г»\n' +
      '🎤 Или отправь голосовое сообщение'
    )
  );

  bot.hears('⚖️ Замер веса', (ctx) => setupWeightHandler(ctx));
  bot.hears('💬 Консультация', (ctx) => setupConsultationHandler(ctx));

  bot.hears('🩺 Загрузить анализы', async (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.awaitingAnalysis = true;
    await ctx.reply(
      '🩺 Отправь скриншот анализов как ФОТО.\n\n' +
      'Я разберу показатели, дам рекомендации по питанию и сравню с предыдущими анализами.\n\n' +
      '⚠️ Это не заменяет консультацию врача.'
    );
  });

  bot.hears(/📈\s*Отч[её]т/i, async (ctx) => {
    const stats = await getDailyStats(ctx.from.id, new Date().toISOString().split('T')[0]);
    if (!stats) return ctx.reply('📊 За сегодня пока нет записей. Добавь приём пищи!');

    const remaining = stats.dailyCalories - stats.calories;
    await ctx.reply(
      `📊 Отчёт за сегодня:\n\n` +
      `🔥 Калории: ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n` +
      `🥩 Белки: ${stats.protein.toFixed(1)} / ${stats.dailyProtein} г\n` +
      `🧈 Жиры: ${stats.fats.toFixed(1)} / ${stats.dailyFats} г\n` +
      `🍞 Углеводы: ${stats.carbs.toFixed(1)} / ${stats.dailyCarbs} г\n\n` +
      (remaining > 0
        ? `💡 Осталось: ${remaining.toFixed(0)} ккал`
        : `⚠️ Превышение: ${Math.abs(remaining).toFixed(0)} ккал`)
    );
  });

  // ---- Медиа ----
  bot.on('photo', setupPhotoHandler);
  bot.on('voice', setupVoiceHandler);
  bot.on('audio', setupVoiceHandler);

  // ---- Текст ----
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    // 1. Заполнение профиля
    if (await handleProfileText(ctx)) return;

    // 2. Ввод веса
    if (await handleWeightText(ctx)) return;

    // 3. Запрос развёрнутого ответа
    if (/дай более развернутый|дай развернутый|подробнее|расскажи детальнее|развернуто|более детально|поподробнее/i.test(text)) {
      if (!ctx.session?.lastConsultation) {
        return ctx.reply('💡 Сначала задай вопрос, и я смогу дать развёрнутый ответ.');
      }
      return ctx.reply(`📚 Развёрнутый ответ:\n\n${ctx.session.lastConsultation}`);
    }

    // 4. Описание еды → считаем КБЖУ
    if (looksLikeFood(text)) {
      const food = await extractFoodFromText(text);
      if (!ctx.session) ctx.session = {};
      ctx.session.pendingMeal = food;
      return ctx.reply(formatFoodCard(food, '🍽️ Распознано'), mealKeyboard());
    }

    // 5. Иначе — консультация
    return setupConsultationHandler(ctx, text);
  });
}