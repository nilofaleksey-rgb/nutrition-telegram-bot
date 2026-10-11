import { Markup } from 'telegraf';
import { setupProfileHandler, setupGenderCallback, handleProfileText } from './profile.js';
import { setupDiaryHandler, setupAddMealCallback, setupMealTimeCallback, setupEditDiaryCallback } from './diary.js';
import { setupPhotoHandler, setupSaveMealCallback } from './photo.js';
import { setupVoiceHandler } from './voice.js';
import { setupWeightHandler, setupWeightHistoryCallback } from './weight.js';
import { setupConsultationHandler, setupDetailedAnswerHandler } from './consultation.js';
import { getUserProfile } from '../services/user.js';
import { getDailyStats } from '../services/stats.js';

export function setupHandlers(bot) {
  setupGenderCallback(bot);
  setupAddMealCallback(bot);
  setupMealTimeCallback(bot);
  setupEditDiaryCallback(bot);
  setupSaveMealCallback(bot);
  setupWeightHistoryCallback(bot);
  setupDetailedAnswerHandler(bot);

  bot.hears('📝 Заполнить профиль', (ctx) => setupProfileHandler(ctx));
  bot.hears('👤 Мой профиль', async (ctx) => {
    const profile = await getUserProfile(ctx.from.id);
    if (!profile) return ctx.reply('Сначала заполни профиль! Нажми "📝 Заполнить профиль"');
    const message = `👤 Твой профиль:\n\n📏 Рост: ${profile.height} см\n⚖️ Текущий вес: ${profile.weight} кг\n🎯 Целевой вес: ${profile.goal_weight} кг\n👤 Пол: ${profile.gender === 'male' ? 'Мужской' : 'Женский'}\n🎂 Возраст: ${profile.age} лет\n\n📊 Дневная норма:\n🔥 ${profile.daily_calories} ккал\n🥩 Белки: ${profile.daily_protein}г\n🧈 Жиры: ${profile.daily_fats}г\n🍞 Углеводы: ${profile.daily_carbs}г\n`;
    await ctx.reply(message, Markup.inlineKeyboard([[Markup.button.callback('✏️ Изменить профиль', 'edit_profile')]]));
  });

  bot.hears('📊 Дневник питания', (ctx) => setupDiaryHandler(ctx));
  bot.hears('📸 Анализ еды', (ctx) => ctx.reply('📸 Отправь фото блюда, и я проанализирую его состав и калорийность!'));
  bot.hears('⚖️ Замер веса', (ctx) => setupWeightHandler(ctx));
  bot.hears('💬 Консультация', (ctx) => setupConsultationHandler(ctx));
  bot.hears('📈 Отчеты', async (ctx) => {
    const stats = await getDailyStats(ctx.from.id, new Date().toISOString().split('T')[0]);
    if (!stats) return ctx.reply('📊 Пока нет данных за сегодня.');
    return ctx.reply(`📊 Сегодня:\n🔥 ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n🥩 ${stats.protein.toFixed(1)} / ${stats.dailyProtein}г\n🧈 ${stats.fats.toFixed(1)} / ${stats.dailyFats}г\n🍞 ${stats.carbs.toFixed(1)} / ${stats.dailyCarbs}г`);
  });

  bot.on('photo', setupPhotoHandler);
  bot.on('voice', setupVoiceHandler);
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const handledProfile = await handleProfileText(ctx);
    if (handledProfile) return;
    if (/дай более развернутый ответ|подробнее|расскажи детальнее|развернуто/i.test(ctx.message.text)) return ctx.reply('💡 Сначала задай вопрос, затем попроси развернутый ответ.');
    await setupConsultationHandler(ctx, ctx.message.text);
  });
}
