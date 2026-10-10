import { addWeightLog, getWeightHistory } from '../services/weight.js';
import { Markup } from 'telegraf';

const weightStates = new Map();

export async function setupWeightHandler(ctx) {
  const userId = ctx.from.id;
  
  weightStates.set(userId, { waitingForWeight: true });
  
  await ctx.reply('⚖️ Введи свой текущий вес в килограммах (например, 72.5):');
}

export function setupWeightInput(bot) {
  bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = weightStates.get(userId);
    
    if (!state || !state.waitingForWeight) return;
    
    const text = ctx.message.text;
    const weight = parseFloat(text);
    
    if (isNaN(weight) || weight < 20 || weight > 300) {
      return ctx.reply('❌ Некорректный вес. Введи число от 20 до 300 кг:');
    }
    
    try {
      const today = new Date().toISOString().split('T')[0];
      
      addWeightLog({
        user_id: userId,
        weight,
        date: today
      });
      
      weightStates.delete(userId);
      
      // Получаем историю для анализа прогресса
      const history = getWeightHistory(userId);
      
      let message = `✅ Вес ${weight} кг записан!\n\n`;
      
      if (history.length >= 2) {
        const previousWeight = history[history.length - 2].weight;
        const diff = weight - previousWeight;
        
        if (diff > 0) {
          message += `📈 +${diff.toFixed(1)} кг с последнего замера`;
        } else if (diff < 0) {
          message += `📉 ${diff.toFixed(1)} кг с последнего замера 🎉`;
        } else {
          message += `➡️ Вес не изменился`;
        }
        
        // Прогресс к цели
        const { getUserProfile } = await import('../services/user.js');
        const profile = getUserProfile(userId);
        
        if (profile && profile.goal_weight) {
          const goalDiff = profile.goal_weight - weight;
          message += `\n🎯 До цели: ${Math.abs(goalDiff).toFixed(1)} кг`;
        }
      }
      
      await ctx.reply(message, 
        Markup.inlineKeyboard([
          [Markup.button.callback('📊 История веса', 'weight_history')]
        ])
      );
      
    } catch (error) {
      console.error('Ошибка записи веса:', error);
      weightStates.delete(userId);
      await ctx.reply('❌ Произошла ошибка при сохранении веса.');
    }
  });
}

export function setupWeightHistoryCallback(bot) {
  bot.action('weight_history', async (ctx) => {
    const userId = ctx.from.id;
    const history = getWeightHistory(userId, 10); // Последние 10 записей
    
    if (!history || history.length === 0) {
      return ctx.answerCbQuery('История пуста');
    }
    
    await ctx.answerCbQuery();
    
    let message = '📊 История замеров веса:\n\n';
    
    history.forEach((log, index) => {
      const date = new Date(log.date).toLocaleDateString('ru-RU');
      message += `${date}: ${log.weight} кг`;
      
      if (index < history.length - 1) {
        const diff = log.weight - history[index + 1].weight;
        if (diff > 0) {
          message += ` (📈 +${diff.toFixed(1)})`;
        } else if (diff < 0) {
          message += ` (📉 ${diff.toFixed(1)})`;
        }
      }
      
      message += '\n';
    });
    
    // Общий прогресс
    if (history.length >= 2) {
      const totalDiff = history[0].weight - history[history.length - 1].weight;
      if (totalDiff !== 0) {
        message += `\n`;
        if (totalDiff < 0) {
          message += `📈 Общий прирост: +${Math.abs(totalDiff).toFixed(1)} кг`;
        } else {
          message += `📉 Общая потеря: ${totalDiff.toFixed(1)} кг 🎉`;
        }
      }
    }
    
    await ctx.reply(message);
  });
}
