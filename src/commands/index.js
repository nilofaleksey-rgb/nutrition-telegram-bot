import { Markup } from 'telegraf';

export function setupCommands(bot) {
  // Команда /start
  bot.command('start', async (ctx) => {
    const welcomeMessage = `
👋 Привет! Я твой AI-ассистент по питанию 🍎

Я помогу тебе:
✅ Достичь желаемого веса
✅ Вести дневник питания
✅ Анализировать блюда по фото
✅ Считать КБЖУ и калории
✅ Получать персональные рекомендации

Начнем с настройки твоего профиля! 🎯
`;

    await ctx.reply(welcomeMessage, 
      Markup.keyboard([
        ['📝 Заполнить профиль', '👤 Мой профиль'],
        ['📊 Дневник питания', '📸 Анализ еды'],
        ['⚖️ Замер веса', '🩺 Загрузить анализы'],
        ['💬 Консультация', '📈 Отчеты']
      ]).resize()
    );
  });

  // Команда /help
  bot.command('help', async (ctx) => {
    const helpMessage = `
🤖 Доступные команды:

/start - Начать работу с ботом
/profile - Настроить профиль
/diary - Дневник питания
/add - Добавить прием пищи
/weight - Записать вес
/report - Отчет за период
/stats - Статистика за сегодня
/help - Помощь

📝 Ты также можешь:
• Отправить фото еды для анализа
• Записать голосом, что съел
• Задать вопрос о питании
`;
    await ctx.reply(helpMessage);
  });

  // Команда /profile
  bot.command('profile', async (ctx) => {
    ctx.scene.enter('profile-setup');
  });

  // Команда /stats
  bot.command('stats', async (ctx) => {
    const { getDailyStats } = await import('../services/stats.js');
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];
    
    const stats = getDailyStats(userId, today);
    
    if (!stats) {
      return ctx.reply('📊 Сегодня ты еще ничего не записал в дневник.');
    }

    const message = `
📊 Статистика за сегодня:

🔥 Калории: ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал
${getProgressBar(stats.calories, stats.dailyCalories)}

Белки: ${stats.protein.toFixed(1)}г / ${stats.dailyProtein}г
Жиры: ${stats.fats.toFixed(1)}г / ${stats.dailyFats}г
Углеводы: ${stats.carbs.toFixed(1)}г / ${stats.dailyCarbs}г

💡 Осталось калорий: ${Math.max(0, stats.dailyCalories - stats.calories).toFixed(0)} ккал
`;

    await ctx.reply(message);
  });
}

function getProgressBar(current, target, length = 10) {
  const percentage = Math.min(100, (current / target) * 100);
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percentage.toFixed(0)}%`;
}
