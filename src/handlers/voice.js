import { transcribeVoice, extractFoodFromText } from '../services/ai.js';
import { addDiaryEntry } from '../services/diary.js';
import { Markup } from 'telegraf';

export async function setupVoiceHandler(ctx) {
  const userId = ctx.from.id;
  
  const processingMsg = await ctx.reply('🎤 Обрабатываю голосовое сообщение...');
  
  try {
    // Получаем голосовое сообщение
    const voice = ctx.message.voice;
    const file = await ctx.telegram.getFile(voice.file_id);
    const voiceUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    // Транскрибируем голос в текст
    const transcription = await transcribeVoice(voiceUrl);
    
    if (!transcription) {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      return ctx.reply('❌ Не удалось распознать речь. Попробуй еще раз.');
    }
    
    // Извлекаем информацию о еде из текста
    const foodData = await extractFoodFromText(transcription);
    
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    
    if (!foodData) {
      return ctx.reply(`Ты сказал: "${transcription}"\n\n❌ Не смог определить блюдо. Попробуй сказать более конкретно, например: "Я съел гречку с курицей"`);
    }
    
    // Показываем распознанное блюдо
    const message = `
🎤 Ты сказал: "${transcription}"

🍽️ Распознано: ${foodData.food_name}

📊 Примерная пищевая ценность:
🔥 Калории: ${foodData.calories.toFixed(0)} ккал
🥩 Белки: ${foodData.protein.toFixed(1)}г
🧈 Жиры: ${foodData.fats.toFixed(1)}г
🍞 Углеводы: ${foodData.carbs.toFixed(1)}г

Добавить в дневник?
`;
    
    // Сохраняем в сессии
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingMeal = foodData;
    
    await ctx.reply(message,
      Markup.inlineKeyboard([
        [Markup.button.callback('🌅 Завтрак', 'save_meal_breakfast'),
         Markup.button.callback('🌞 Обед', 'save_meal_lunch')],
        [Markup.button.callback('🌙 Ужин', 'save_meal_dinner'),
         Markup.button.callback('🍎 Перекус', 'save_meal_snack')],
        [Markup.button.callback('❌ Отменить', 'cancel_meal')]
      ])
    );
    
  } catch (error) {
    console.error('Ошибка обработки голоса:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('❌ Произошла ошибка при обработке голосового сообщения.');
  }
}
