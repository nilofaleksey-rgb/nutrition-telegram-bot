import { transcribeVoice, extractFoodFromText } from '../services/ai.js';
import { Markup } from 'telegraf';

export async function setupVoiceHandler(ctx) {
  const processingMsg = await ctx.reply('🎤 Обрабатываю голосовое сообщение...');
  try {
    const transcription = await transcribeVoice();
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    if (!transcription) return ctx.reply('❌ Не удалось распознать речь. Попробуй еще раз.');
    const foodData = await extractFoodFromText(transcription);
    if (!foodData) return ctx.reply(`Ты сказал: "${transcription}"\n\n❌ Не смог определить блюдо.`);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingMeal = foodData;
    await ctx.reply(`🎤 Ты сказал: "${transcription}"\n\n🍽️ Распознано: ${foodData.food_name}\n\n📊 Примерная пищевая ценность:\n🔥 Калории: ${foodData.calories.toFixed(0)} ккал\n🥩 Белки: ${foodData.protein.toFixed(1)}г\n🧈 Жиры: ${foodData.fats.toFixed(1)}г\n🍞 Углеводы: ${foodData.carbs.toFixed(1)}г\n\nДобавить в дневник?`, Markup.inlineKeyboard([[Markup.button.callback('🌅 Завтрак', 'save_meal_breakfast'), Markup.button.callback('🌞 Обед', 'save_meal_lunch')], [Markup.button.callback('🌙 Ужин', 'save_meal_dinner'), Markup.button.callback('🍎 Перекус', 'save_meal_snack')], [Markup.button.callback('❌ Отменить', 'cancel_meal')]]));
  } catch (error) {
    console.error('Ошибка обработки голоса:', error);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch {}
    await ctx.reply('❌ Произошла ошибка при обработке голосового сообщения.');
  }
}
