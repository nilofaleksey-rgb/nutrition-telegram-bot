import { Markup } from 'telegraf';
import { getDailyDiary, deleteDiaryEntry } from '../services/diary.js';
import { getDailyStats } from '../services/stats.js';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export async function setupDiaryHandler(ctx) {
  const userId = ctx.from.id;
  const today = new Date().toISOString().split('T')[0];
  
  const diary = getDailyDiary(userId, today);
  const stats = getDailyStats(userId, today);
  
  if (!diary || diary.length === 0) {
    return ctx.reply('📊 Твой дневник на сегодня пуст.\n\nДобавь прием пищи:', 
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить прием пищи', 'add_meal')]
      ])
    );
  }
  
  // Формируем сообщение с дневником
  let message = `📊 Дневник питания на ${format(new Date(), 'd MMMM', { locale: ru })}:\n\n`;
  
  // Группируем по времени приема пищи
  const groupedDiary = {};
  diary.forEach(entry => {
    if (!groupedDiary[entry.meal_time]) {
      groupedDiary[entry.meal_time] = [];
    }
    groupedDiary[entry.meal_time].push(entry);
  });
  
  const mealTimeEmojis = {
    'breakfast': '🌅 Завтрак',
    'lunch': '🌞 Обед',
    'dinner': '🌙 Ужин',
    'snack': '🍎 Перекус'
  };
  
  Object.entries(groupedDiary).forEach(([mealTime, entries]) => {
    message += `${mealTimeEmojis[mealTime] || mealTime}:\n`;
    entries.forEach(entry => {
      message += `  • ${entry.food_name}\n`;
      message += `    ${entry.calories.toFixed(0)} ккал | Б: ${entry.protein.toFixed(1)}г Ж: ${entry.fats.toFixed(1)}г У: ${entry.carbs.toFixed(1)}г\n`;
    });
    message += '\n';
  });
  
  // Добавляем статистику
  if (stats) {
    message += `📈 Итого за день:\n`;
    message += `🔥 ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n`;
    message += getProgressBar(stats.calories, stats.dailyCalories);
    message += `\n\n`;
    message += `Белки: ${stats.protein.toFixed(1)}г / ${stats.dailyProtein}г\n`;
    message += `Жиры: ${stats.fats.toFixed(1)}г / ${stats.dailyFats}г\n`;
    message += `Углеводы: ${stats.carbs.toFixed(1)}г / ${stats.dailyCarbs}г\n\n`;
    
    const remaining = stats.dailyCalories - stats.calories;
    if (remaining > 0) {
      message += `💡 Осталось: ${remaining.toFixed(0)} ккал`;
    } else {
      message += `⚠️ Превышение: ${Math.abs(remaining).toFixed(0)} ккал`;
    }
  }
  
  // Кнопки управления
  const buttons = [
    [Markup.button.callback('➕ Добавить прием', 'add_meal')],
    [Markup.button.callback('✏️ Редактировать', 'edit_diary'), 
     Markup.button.callback('📈 График дня', 'show_chart')]
  ];
  
  await ctx.reply(message, Markup.inlineKeyboard(buttons));
}

function getProgressBar(current, target, length = 15) {
  const percentage = Math.min(100, (current / target) * 100);
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percentage.toFixed(0)}%`;
}

// Обработчик добавления приема пищи
export function setupAddMealCallback(bot) {
  bot.action('add_meal', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🍽️ Выбери время приема пищи:', 
      Markup.inlineKeyboard([
        [Markup.button.callback('🌅 Завтрак', 'meal_breakfast'),
         Markup.button.callback('🌞 Обед', 'meal_lunch')],
        [Markup.button.callback('🌙 Ужин', 'meal_dinner'),
         Markup.button.callback('🍎 Перекус', 'meal_snack')]
      ])
    );
  });
}

// Обработчик выбора времени приема пищи
export function setupMealTimeCallback(bot) {
  bot.action(/meal_(.+)/, async (ctx) => {
    const mealTime = ctx.match[1];
    
    // Сохраняем в сессии
    if (!ctx.session) ctx.session = {};
    ctx.session.mealTime = mealTime;
    
    await ctx.answerCbQuery();
    await ctx.reply('Отлично! Теперь:\n\n📸 Отправь фото блюда для автоматического анализа\n✍️ Или напиши название блюда текстом\n🎤 Или запиши голосом');
  });
}

// Обработчик редактирования дневника
export function setupEditDiaryCallback(bot) {
  bot.action('edit_diary', async (ctx) => {
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];
    const diary = getDailyDiary(userId, today);
    
    if (!diary || diary.length === 0) {
      return ctx.answerCbQuery('Дневник пуст');
    }
    
    await ctx.answerCbQuery();
    
    const buttons = diary.map(entry => [
      Markup.button.callback(
        `❌ ${entry.food_name} (${entry.calories.toFixed(0)} ккал)`,
        `delete_entry_${entry.id}`
      )
    ]);
    
    await ctx.reply('Выбери запись для удаления:', Markup.inlineKeyboard(buttons));
  });
  
  bot.action(/delete_entry_(\d+)/, async (ctx) => {
    const entryId = parseInt(ctx.match[1]);
    
    try {
      deleteDiaryEntry(entryId);
      await ctx.answerCbQuery('✅ Запись удалена');
      await setupDiaryHandler(ctx);
    } catch (error) {
      console.error('Ошибка удаления записи:', error);
      await ctx.answerCbQuery('❌ Ошибка при удалении');
    }
  });
}
