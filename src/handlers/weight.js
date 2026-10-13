import { addWeightLog, getWeightHistory } from '../services/weight.js';
import { getUserProfile } from '../services/user.js';
import { Markup } from 'telegraf';

export async function setupWeightHandler(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingWeight = true;
  await ctx.reply('⚖️ Введи свой текущий вес в килограммах (например, 72.5):');
}

/** Обрабатывает текстовый ввод веса. true — сообщение было обработано. */
export async function handleWeightText(ctx) {
  if (!ctx.session?.awaitingWeight) return false;

  const text = ctx.message?.text;
  if (!text) return false;

  const weight = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));

  if (Number.isNaN(weight) || weight < 20 || weight > 300) {
    await ctx.reply('❌ Некорректный вес. Введи число от 20 до 300 кг:');
    return true;
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    await addWeightLog({ user_id: ctx.from.id, weight, date: today });
    delete ctx.session.awaitingWeight;

    const history = await getWeightHistory(ctx.from.id, 30);
    const profile = await getUserProfile(ctx.from.id);

    let message = `✅ Вес ${weight} кг записан!\n\n`;

    if (history.length >= 2) {
      const diff = weight - history[1].weight;
      if (diff > 0.05) message += `📈 +${diff.toFixed(1)} кг с прошлого замера\n`;
      else if (diff < -0.05) message += `📉 ${diff.toFixed(1)} кг с прошлого замера 🎉\n`;
      else message += `➡️ Вес не изменился\n`;
    }

    if (profile?.goal_weight) {
      const goalDiff = weight - profile.goal_weight;
      message += Math.abs(goalDiff) < 0.1
        ? '🎯 Ты достиг целевого веса! Поздравляю 🎉'
        : `🎯 До цели: ${Math.abs(goalDiff).toFixed(1)} кг (цель ${profile.goal_weight} кг)`;
    }

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('📊 История веса', 'weight_history')]
    ]));
  } catch (error) {
    console.error('Ошибка записи веса:', error);
    delete ctx.session.awaitingWeight;
    await ctx.reply('❌ Произошла ошибка при сохранении веса.');
  }

  return true;
}

export function setupWeightHistoryCallback(bot) {
  bot.action('weight_history', async (ctx) => {
    const history = await getWeightHistory(ctx.from.id, 15);

    if (!history?.length) {
      return ctx.answerCbQuery('История пуста');
    }

    await ctx.answerCbQuery();

    let message = '📊 История замеров веса:\n\n';

    history.forEach((log, index) => {
      const date = new Date(log.date).toLocaleDateString('ru-RU');
      message += `${date}: ${log.weight} кг`;

      if (index < history.length - 1) {
        const diff = log.weight - history[index + 1].weight;
        if (diff > 0.05) message += ` (📈 +${diff.toFixed(1)})`;
        else if (diff < -0.05) message += ` (📉 ${diff.toFixed(1)})`;
      }

      message += '\n';
    });

    if (history.length >= 2) {
      const totalDiff = history[0].weight - history[history.length - 1].weight;
      if (Math.abs(totalDiff) > 0.05) {
        message += totalDiff < 0
          ? `\n📈 Общий прирост: +${Math.abs(totalDiff).toFixed(1)} кг`
          : `\n📉 Общая потеря: ${totalDiff.toFixed(1)} кг 🎉`;
      }
    }

    await ctx.reply(message);
  });
}