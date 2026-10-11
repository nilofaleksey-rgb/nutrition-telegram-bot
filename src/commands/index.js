import { Markup } from 'telegraf';
import { getDailyStats } from '../services/stats.js';
import { setupProfileHandler } from '../handlers/profile.js';
import { setupDiaryHandler } from '../handlers/diary.js';
import { setupWeightHandler } from '../handlers/weight.js';
import { setupConsultationHandler } from '../handlers/consultation.js';

export function setupCommands(bot) {
  bot.command('start', async (ctx) => {
    const welcomeMessage = `👋 Привет! Я твой AI-ассистент по питанию 🍎\n\nЯ помогу тебе:\n✅ Достичь желаемого веса\n✅ Вести дневник питания\n✅ Анализировать блюда по фото\n✅ Считать КБЖУ и калории\n✅ Получать персональные рекомендации\n\nНачнем с настройки твоего профиля! 🎯`;
    await ctx.reply(welcomeMessage, Markup.keyboard([['📝 Заполнить профиль', '👤 Мой профиль'], ['📊 Дневник питания', '📸 Анализ еды'], ['⚖️ Замер веса', '🩺 Загрузить анализы'], ['💬 Консультация', '📈 Отчеты']]).resize());
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(`🤖 Доступные команды:\n\n/start - Начать работу с ботом\n/profile - Настроить профиль\n/diary - Дневник питания\n/add - Добавить прием пищи\n/weight - Записать вес\n/report - Отчет за период\n/stats - Статистика за сегодня\n/help - Помощь`);
  });

  bot.command('profile', async (ctx) => setupProfileHandler(ctx));
  bot.command('diary', async (ctx) => setupDiaryHandler(ctx));
  bot.command('weight', async (ctx) => setupWeightHandler(ctx));
  bot.command('stats', async (ctx) => {
    const stats = await getDailyStats(ctx.from.id, new Date().toISOString().split('T')[0]);
    if (!stats) return ctx.reply('📊 Сегодня ты еще ничего не записал в дневник.');
    await ctx.reply(`📊 Статистика за сегодня:\n🔥 Калории: ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n🥩 Белки: ${stats.protein.toFixed(1)}г / ${stats.dailyProtein}г\n🧈 Жиры: ${stats.fats.toFixed(1)}г / ${stats.dailyFats}г\n🍞 Углеводы: ${stats.carbs.toFixed(1)}г / ${stats.dailyCarbs}г`);
  });
  bot.command('ask', async (ctx) => setupConsultationHandler(ctx));
}
