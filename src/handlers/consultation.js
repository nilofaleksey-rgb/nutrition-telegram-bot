import { getUserProfile } from '../services/user.js';
import { getDailyStats } from '../services/stats.js';
import { getConsultation } from '../services/ai.js';

export async function setupConsultationHandler(ctx, question = null) {
  if (!question) {
    return ctx.reply(
      '💬 Задай вопрос о питании, и я отвечу как диетолог с 10-летним опытом.\n\n' +
      'Например:\n' +
      '• Что лучше съесть на завтрак?\n' +
      '• Как добрать белок в рационе?\n' +
      '• Можно ли мне есть сладкое вечером?\n' +
      '• Каких витаминов может не хватать?\n\n' +
      '💡 Если ответ покажется коротким — напиши «дай более развернутый ответ».'
    );
  }

  const loading = await ctx.reply('🤔 Думаю...');

  try {
    const profile = await getUserProfile(ctx.from.id);
    const stats = await getDailyStats(ctx.from.id, new Date().toISOString().split('T')[0]);

    const response = await getConsultation({ question, profile, todayStats: stats });

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (!ctx.session) ctx.session = {};
    ctx.session.lastConsultation = response.detailed;
    ctx.session.lastQuestion = question;

    await ctx.reply(
      `💡 ${response.short}\n\n<i>Хочешь подробнее? Напиши «дай более развернутый ответ».</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка консультации:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('❌ Не удалось обработать вопрос. Попробуй переформулировать.');
  }
}

export function setupDetailedAnswerHandler(bot) {
  bot.hears(/дай более развернутый|дай развернутый|подробнее|поподробнее|расскажи детальнее|развернуто/i, async (ctx) => {
    if (!ctx.session?.lastConsultation) {
      return ctx.reply('💡 Сначала задай вопрос, и я смогу дать развёрнутый ответ.');
    }
    await ctx.reply(`📚 Развёрнутый ответ:\n\n${ctx.session.lastConsultation}`);
  });
}