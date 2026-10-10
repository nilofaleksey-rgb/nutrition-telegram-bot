import { getConsultation } from '../services/ai.js';
import { getUserProfile } from '../services/user.js';
import { getDailyStats } from '../services/stats.js';

export async function setupConsultationHandler(ctx, question = null) {
  const userId = ctx.from.id;
  
  // Если вопроса нет, просим задать
  if (!question) {
    return ctx.reply('💬 Задай свой вопрос о питании, диете или здоровье, и я постараюсь помочь!\n\nНапример:\n• Какие продукты лучше есть на завтрак?\n• Как увеличить количество белка в рационе?\n• Можно ли мне есть банан перед тренировкой?');
  }
  
  const thinkingMsg = await ctx.reply('🤔 Думаю...');
  
  try {
    // Получаем контекст пользователя
    const profile = getUserProfile(userId);
    const today = new Date().toISOString().split('T')[0];
    const stats = getDailyStats(userId, today);
    
    // Формируем контекст для AI
    const context = {
      profile,
      todayStats: stats,
      question
    };
    
    // Получаем ответ от AI
    const response = await getConsultation(context);
    
    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
    
    // Отправляем краткий ответ
    await ctx.reply(`💡 ${response.short}`);
    
    // Сохраняем полный ответ в контексте для возможности запроса детального ответа
    if (!ctx.session) ctx.session = {};
    ctx.session.lastConsultation = response.detailed;
    
  } catch (error) {
    console.error('Ошибка консультации:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
    await ctx.reply('❌ Произошла ошибка при обработке вопроса. Попробуй переформулировать или задай другой вопрос.');
  }
}

// Обработчик запроса развернутого ответа
export function setupDetailedAnswerHandler(bot) {
  bot.hears(/дай более развернутый ответ|подробнее|расскажи детальнее|развернуто/i, async (ctx) => {
    if (!ctx.session || !ctx.session.lastConsultation) {
      return ctx.reply('❌ Сначала задай вопрос, и я смогу дать развернутый ответ.');
    }
    
    const thinkingMsg = await ctx.reply('📝 Готовлю развернутый ответ...');
    
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
      await ctx.reply(`📚 Развернутый ответ:\n\n${ctx.session.lastConsultation}`);
    } catch (error) {
      console.error('Ошибка отправки развернутого ответа:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  });
}
