import { analyzeFoodImage, shortRecommendation } from '../services/ai.js';
import { addDiaryEntry } from '../services/diary.js';
import { getDailyStats } from '../services/stats.js';
import { Markup } from 'telegraf';

export const MEAL_EMOJI = {
  breakfast: '🌅 Завтрак',
  lunch: '🌞 Обед',
  dinner: '🌙 Ужин',
  snack: '🍎 Перекус'
};

export function mealKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🌅 Завтрак', 'save_meal_breakfast'), Markup.button.callback('🌞 Обед', 'save_meal_lunch')],
    [Markup.button.callback('🌙 Ужин', 'save_meal_dinner'), Markup.button.callback('🍎 Перекус', 'save_meal_snack')],
    [Markup.button.callback('✏️ Есть замечания', 'fb_food'), Markup.button.callback('❌ Отменить', 'cancel_meal')]
  ]);
}

/** Скачивает файл из Telegram и возвращает буфер. */
export async function downloadTelegramFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Не удалось скачать файл: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function formatFoodCard(food, title = '📸 Анализ блюда') {
  return `${title}\n\n🍽️ ${food.food_name}\n\n📊 Пищевая ценность:\n🔥 Калории: ${food.calories.toFixed(0)} ккал\n🥩 Белки: ${food.protein.toFixed(1)} г\n🧈 Жиры: ${food.fats.toFixed(1)} г\n🍞 Углеводы: ${food.carbs.toFixed(1)} г\n\nДобавить в дневник?`;
}

export async function setupPhotoHandler(ctx) {
  if (!ctx.session) ctx.session = {};

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const isHealthMode = Boolean(ctx.session.awaitingAnalysis);
  const loading = await ctx.reply(isHealthMode ? '🩺 Анализирую показатели...' : '🔍 Анализирую фото...');

  try {
    const buffer = await downloadTelegramFile(ctx, photo.file_id);

    // Режим анализа медицинских анализов
    if (isHealthMode) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
      delete ctx.session.awaitingAnalysis;
      const { handleHealthPhoto } = await import('./health.js');
      return handleHealthPhoto(ctx, buffer, 'image/jpeg');
    }

    const { getPersonalContext } = await import('../services/feedback.js');
    const personalContext = await getPersonalContext(ctx.from.id);
    const result = await analyzeFoodImage(buffer, 'image/jpeg', personalContext);

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (result?.error === 'no_vision_provider') {
      return ctx.reply(
        '📸 Для распознавания фото нужен бесплатный ключ Google Gemini.\n\n' +
        'Получи его за минуту (карта не нужна): https://aistudio.google.com/apikey\n' +
        'Затем добавь переменную окружения:\nGEMINI_API_KEY=твой_ключ\n\n' +
        'Пока можешь написать текстом, что съел — например: «гречка с курицей 250 г» ✍️'
      );
    }

    if (result?.error === 'no_food') {
      return ctx.reply('🤔 На фото не видно еды. Сфотографируй блюдо целиком и попробуй снова.');
    }

    if (result?.error) {
      return ctx.reply('❌ Не удалось распознать блюдо. Попробуй более чёткое фото или напиши текстом.');
    }

    ctx.session.pendingMeal = result;
    await ctx.reply(formatFoodCard(result), mealKeyboard());
  } catch (error) {
    console.error('Ошибка анализа фото:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('❌ Произошла ошибка при анализе фото. Попробуй ещё раз или напиши текстом.');
  }
}

export function setupSaveMealCallback(bot) {
  bot.action(/save_meal_(.+)/, async (ctx) => {
    const mealTime = ctx.match[1];
    const userId = ctx.from.id;

    if (!ctx.session?.pendingMeal) {
      return ctx.answerCbQuery('❌ Данные устарели, отправь блюдо заново');
    }

    const meal = ctx.session.pendingMeal;
    const today = new Date().toISOString().split('T')[0];

    try {
      await addDiaryEntry({
        user_id: userId,
        date: today,
        meal_time: mealTime,
        food_name: meal.food_name,
        calories: meal.calories,
        protein: meal.protein,
        fats: meal.fats,
        carbs: meal.carbs,
        photo_url: meal.photo_url || null
      });

      delete ctx.session.pendingMeal;
      await ctx.answerCbQuery('✅ Добавлено!');

      const stats = await getDailyStats(userId, today);
      let message = `✅ ${MEAL_EMOJI[mealTime] || mealTime}: ${meal.food_name}\n\n`;

      if (stats) {
        const remaining = stats.dailyCalories - stats.calories;
        message += `📊 Итого за сегодня:\n`;
        message += `🔥 ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n`;
        message += `🥩 Белки: ${stats.protein.toFixed(1)} / ${stats.dailyProtein} г\n`;
        message += `🧈 Жиры: ${stats.fats.toFixed(1)} / ${stats.dailyFats} г\n`;
        message += `🍞 Углеводы: ${stats.carbs.toFixed(1)} / ${stats.dailyCarbs} г\n\n`;
        message += remaining > 0
          ? `💡 Осталось: ${remaining.toFixed(0)} ккал\n\n`
          : `⚠️ Превышение: ${Math.abs(remaining).toFixed(0)} ккал\n\n`;

        const advice = shortRecommendation(stats, mealTime);
        if (advice) message += advice;
      }

      await ctx.reply(message);
    } catch (error) {
      console.error('Ошибка добавления в дневник:', error);
      await ctx.answerCbQuery('❌ Ошибка при сохранении');
    }
  });

  bot.action('cancel_meal', async (ctx) => {
    if (ctx.session) delete ctx.session.pendingMeal;
    await ctx.answerCbQuery('Отменено');
    await ctx.reply('❌ Отменено');
  });
}