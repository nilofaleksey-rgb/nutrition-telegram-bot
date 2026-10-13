import { transcribeVoice, extractFoodFromText, hasGemini } from '../services/ai.js';
import { downloadTelegramFile, formatFoodCard, mealKeyboard } from './photo.js';

export async function setupVoiceHandler(ctx) {
  const loading = await ctx.reply('🎤 Обрабатываю голосовое сообщение...');

  try {
    if (!ctx.session) ctx.session = {};

    const voice = ctx.message.voice || ctx.message.audio;
    if (!voice) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
      return ctx.reply('❌ Не удалось получить аудио. Попробуй ещё раз.');
    }

    if (!hasGemini()) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
      return ctx.reply(
        '🎤 Для распознавания голоса нужен бесплатный ключ Google Gemini.\n\n' +
        'Получи его за минуту (карта не нужна): https://aistudio.google.com/apikey\n' +
        'Затем добавь переменную окружения:\nGEMINI_API_KEY=твой_ключ\n\n' +
        'Пока напиши текстом, что съел ✍️'
      );
    }

    const buffer = await downloadTelegramFile(ctx, voice.file_id);
    const transcription = await transcribeVoice(buffer, 'audio/ogg');

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (!transcription) {
      return ctx.reply('❌ Не удалось распознать речь. Запиши ещё раз или напиши текстом.');
    }

    const food = await extractFoodFromText(transcription);
    ctx.session.pendingMeal = food;

    await ctx.reply(formatFoodCard(food, `🎤 Ты сказал: «${transcription}»`), mealKeyboard());
  } catch (error) {
    console.error('Ошибка обработки голоса:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('❌ Произошла ошибка при обработке голосового сообщения.');
  }
}