import { getConsultation } from '../services/ai.js';
import { getUserProfile } from '../services/user.js';
import { getDailyStats } from '../services/stats.js';

export async function setupConsultationHandler(ctx, question = null) {
  const userId = ctx.from.id;
  if (!question) {
    return ctx.reply('💬 Задай свой вопрос о питании, диете или здоровье, и я постараюсь помочь!\n\nНапример:\n• Какие продукты лучше есть на завтрак?\n• Как увеличить количество белка в рационе?\n• Можно ли мне есть банан перед тренировкой?');
  }
  const thinkingMsg = await ctx.reply('🤔 Думаю...');
  try {
    const profile = await getUserProfile(userId);
    const today = new Date().toISOString().split('T')[0];
    const stats = await getDailyStats(userId, today);
    const response = await getConsultation({ profile, todayStats: stats, question });
    try { await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id); } catch {}
    await ctx.reply(`💡 ${response.short}`);
    if (!ctx.session) ctx.session = {};
    ctx.session.lastConsultation = response.detailed;
  } catch (error) {
    console.error('Ошибка консультации:', error);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id); } catch {}
    await ctx.reply('❌ Произошла ошибка при обработке вопроса. Попробуй переформулировать или задай другой вопрос.');
  }
}

export function setupDetailedAnswerHandler(bot) {
  bot.hears(/дай более развернутый ответ|подробнее|расскажи детальнее|развернуто/i, async (ctx) => {
    if (!ctx.session || !ctx.session.lastConsultation) return ctx.reply('❌ Сначала задай вопрос, и я смогу дать развернутый ответ.');
    await ctx.reply(`📚 Развернутый ответ:\n\n${ctx.session.lastConsultation}`);
  });
}
