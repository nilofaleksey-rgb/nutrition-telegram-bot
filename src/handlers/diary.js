import { Markup } from 'telegraf';
import { getDailyDiary, deleteDiaryEntry } from '../services/diary.js';
import { getDailyStats } from '../services/stats.js';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

const MEAL_LABELS = {
  breakfast: '🌅 Завтрак',
  lunch: '🌞 Обед',
  snack: '🍎 Перекус',
  dinner: '🌙 Ужин'
};

export function progressBar(current, target, length = 12) {
  const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const filled = Math.max(0, Math.min(length, Math.round((percentage / 100) * length)));
  return '█'.repeat(filled) + '░'.repeat(length - filled) + ` ${percentage.toFixed(0)}%`;
}

export async function setupDiaryHandler(ctx) {
  const userId = ctx.from.id;
  const today = new Date().toISOString().split('T')[0];

  const diary = await getDailyDiary(userId, today);
  const stats = await getDailyStats(userId, today);

  if (!diary?.length) {
    return ctx.reply(
      '📊 Дневник на сегодня пуст.\n\nДобавь приём пищи 👇',
      Markup.inlineKeyboard([[Markup.button.callback('➕ Добавить приём пищи', 'add_meal')]])
    );
  }

  let message = `📊 Дневник питания на ${format(new Date(), 'd MMMM', { locale: ru })}:\n\n`;

  const grouped = {};
  for (const entry of diary) {
    (grouped[entry.meal_time] ||= []).push(entry);
  }

  for (const [mealTime, entries] of Object.entries(grouped)) {
    message += `${MEAL_LABELS[mealTime] || mealTime}:\n`;
    for (const entry of entries) {
      message += `  • ${entry.food_name}\n`;
      message += `    ${Number(entry.calories).toFixed(0)} ккал | Б ${Number(entry.protein).toFixed(1)} Ж ${Number(entry.fats).toFixed(1)} У ${Number(entry.carbs).toFixed(1)}\n`;
    }
    message += '\n';
  }

  if (stats) {
    const remaining = stats.dailyCalories - stats.calories;
    message += `📈 Итого за день:\n`;
    message += `🔥 ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n`;
    message += `${progressBar(stats.calories, stats.dailyCalories)}\n\n`;
    message += `🥩 Белки: ${stats.protein.toFixed(1)} / ${stats.dailyProtein} г\n`;
    message += `🧈 Жиры: ${stats.fats.toFixed(1)} / ${stats.dailyFats} г\n`;
    message += `🍞 Углеводы: ${stats.carbs.toFixed(1)} / ${stats.dailyCarbs} г\n\n`;
    message += remaining > 0
      ? `💡 Осталось: ${remaining.toFixed(0)} ккал`
      : `⚠️ Превышение: ${Math.abs(remaining).toFixed(0)} ккал`;
  }

  await ctx.reply(message, Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить приём', 'add_meal'), Markup.button.callback('✏️ Редактировать', 'edit_diary')]
  ]));
}

export function setupAddMealCallback(bot) {
  bot.action('add_meal', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '🍽️ Выбери приём пищи:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🌅 Завтрак', 'meal_breakfast'), Markup.button.callback('🌞 Обед', 'meal_lunch')],
        [Markup.button.callback('🌙 Ужин', 'meal_dinner'), Markup.button.callback('🍎 Перекус', 'meal_snack')]
      ])
    );
  });
}

export function setupMealTimeCallback(bot) {
  bot.action(/^meal_(breakfast|lunch|dinner|snack)$/, async (ctx) => {
    const mealTime = ctx.match[1];

    if (!ctx.session) ctx.session = {};
    ctx.session.mealTime = mealTime;
    ctx.session.awaitingFood = true;

    await ctx.answerCbQuery();
    await ctx.reply(
      `${MEAL_LABELS[mealTime]}: отправь еду любым способом:\n\n` +
      '📸 фото блюда\n✍️ текст: «гречка с курицей 250 г»\n🎤 голосовое сообщение'
    );
  });
}

export function setupEditDiaryCallback(bot) {
  bot.action('edit_diary', async (ctx) => {
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];
    const diary = await getDailyDiary(userId, today);

    if (!diary?.length) {
      return ctx.answerCbQuery('Дневник пуст');
    }

    await ctx.answerCbQuery();

    const buttons = diary.map((entry) => [
      Markup.button.callback(
        `❌ ${String(entry.food_name).slice(0, 30)} (${Number(entry.calories).toFixed(0)} ккал)`,
        `delete_entry_${entry.id}`
      )
    ]);

    buttons.push([Markup.button.callback('⬅️ Назад к дневнику', 'show_diary')]);

    await ctx.reply('Выбери запись для удаления:', Markup.inlineKeyboard(buttons));
  });

  bot.action('show_diary', async (ctx) => {
    await ctx.answerCbQuery();
    await setupDiaryHandler(ctx);
  });

  bot.action(/^delete_entry_(\d+)$/, async (ctx) => {
    const entryId = parseInt(ctx.match[1], 10);

    try {
      await deleteDiaryEntry(entryId);
      await ctx.answerCbQuery('✅ Запись удалена');
      await ctx.reply('✅ Запись удалена — обновляю дневник 👇');
      await setupDiaryHandler(ctx);
    } catch (error) {
      console.error('Ошибка удаления записи:', error);
      await ctx.answerCbQuery('❌ Ошибка при удалении');
    }
  });
}