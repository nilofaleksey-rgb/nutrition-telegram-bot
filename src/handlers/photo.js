import { analyzeFood } from '../services/ai.js';
import { addDiaryEntry } from '../services/diary.js';
import { Markup } from 'telegraf';

export async function setupPhotoHandler(ctx) {
  const processingMsg = await ctx.reply('🔍 Анализирую фото...');
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const analysis = await analyzeFood(photoUrl);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    if (!analysis) return ctx.reply('❌ Не удалось распознать еду на фото. Попробуй еще раз с более четким изображением.');
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingMeal = { ...analysis, photo_url: photoUrl };
    await ctx.reply(`📸 Анализ блюда:\n\n🍽️ ${analysis.food_name}\n\n📊 Пищевая ценность:\n🔥 Калории: ${analysis.calories.toFixed(0)} ккал\n🥩 Белки: ${analysis.protein.toFixed(1)}г\n🧈 Жиры: ${analysis.fats.toFixed(1)}г\n🍞 Углеводы: ${analysis.carbs.toFixed(1)}г\n\nДобавить в дневник?`, Markup.inlineKeyboard([[Markup.button.callback('🌅 Завтрак', 'save_meal_breakfast'), Markup.button.callback('🌞 Обед', 'save_meal_lunch')], [Markup.button.callback('🌙 Ужин', 'save_meal_dinner'), Markup.button.callback('🍎 Перекус', 'save_meal_snack')], [Markup.button.callback('❌ Отменить', 'cancel_meal')]]));
  } catch (error) {
    console.error('Ошибка анализа фото:', error);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch {}
    await ctx.reply('❌ Произошла ошибка при анализе фото. Попробуй еще раз.');
  }
}

export function setupSaveMealCallback(bot) {
  bot.action(/save_meal_(.+)/, async (ctx) => {
    const mealTime = ctx.match[1];
    const userId = ctx.from.id;
    if (!ctx.session || !ctx.session.pendingMeal) return ctx.answerCbQuery('❌ Данные устарели, попробуй еще раз');
    const meal = ctx.session.pendingMeal;
    const today = new Date().toISOString().split('T')[0];
    try {
      await addDiaryEntry({ user_id: userId, date: today, meal_time: mealTime, food_name: meal.food_name, calories: meal.calories, protein: meal.protein, fats: meal.fats, carbs: meal.carbs, photo_url: meal.photo_url });
      delete ctx.session.pendingMeal;
      await ctx.answerCbQuery('✅ Добавлено в дневник!');
      await ctx.reply('✅ Блюдо добавлено в дневник!');
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
