import { analyzeFood } from '../services/ai.js';
import { addDiaryEntry } from '../services/diary.js';
import { Markup } from 'telegraf';

export async function setupPhotoHandler(ctx) {
  const userId = ctx.from.id;
  
  // Показываем что бот обрабатывает фото
  const processingMsg = await ctx.reply('🔍 Анализирую фото...');
  
  try {
    // Получаем файл фото
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Берем самое большое фото
    const file = await ctx.telegram.getFile(photo.file_id);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    // Анализируем через AI
    const analysis = await analyzeFood(photoUrl);
    
    if (!analysis) {
      return ctx.reply('❌ Не удалось распознать еду на фото. Попробуй еще раз с более четким изображением.');
    }
    
    // Удаляем сообщение о обработке
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    
    // Формируем ответ с результатом
    const message = `
📸 Анализ блюда:

🍽️ ${analysis.food_name}

📊 Пищевая ценность:
🔥 Калории: ${analysis.calories.toFixed(0)} ккал
🥩 Белки: ${analysis.protein.toFixed(1)}г
🧈 Жиры: ${analysis.fats.toFixed(1)}г
🍞 Углеводы: ${analysis.carbs.toFixed(1)}г

Добавить в дневник?
`;
    
    // Сохраняем данные в сессии для последующего добавления
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingMeal = {
      ...analysis,
      photo_url: photoUrl
    };
    
    await ctx.reply(message, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🌅 Завтрак', 'save_meal_breakfast'),
         Markup.button.callback('🌞 Обед', 'save_meal_lunch')],
        [Markup.button.callback('🌙 Ужин', 'save_meal_dinner'),
         Markup.button.callback('🍎 Перекус', 'save_meal_snack')],
        [Markup.button.callback('❌ Отменить', 'cancel_meal')]
      ])
    );
    
  } catch (error) {
    console.error('Ошибка анализа фото:', error);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('❌ Произошла ошибка при анализе фото. Попробуй еще раз.');
  }
}

// Обработчик сохранения блюда в дневник
export function setupSaveMealCallback(bot) {
  bot.action(/save_meal_(.+)/, async (ctx) => {
    const mealTime = ctx.match[1];
    const userId = ctx.from.id;
    
    if (!ctx.session || !ctx.session.pendingMeal) {
      return ctx.answerCbQuery('❌ Данные устарели, попробуй еще раз');
    }
    
    const meal = ctx.session.pendingMeal;
    const today = new Date().toISOString().split('T')[0];
    
    try {
      addDiaryEntry({
        user_id: userId,
        date: today,
        meal_time: mealTime,
        food_name: meal.food_name,
        calories: meal.calories,
        protein: meal.protein,
        fats: meal.fats,
        carbs: meal.carbs,
        photo_url: meal.photo_url
      });
      
      // Очищаем сессию
      delete ctx.session.pendingMeal;
      
      await ctx.answerCbQuery('✅ Добавлено в дневник!');
      
      // Показываем обновленный дневник
      const { getDailyStats } = await import('../services/stats.js');
      const stats = getDailyStats(userId, today);
      
      let message = '✅ Блюдо добавлено в дневник!\n\n';
      
      if (stats) {
        message += `📊 Итого за день:\n`;
        message += `🔥 ${stats.calories.toFixed(0)} / ${stats.dailyCalories} ккал\n`;
        message += `🥩 Белки: ${stats.protein.toFixed(1)}г / ${stats.dailyProtein}г\n`;
        message += `🧈 Жиры: ${stats.fats.toFixed(1)}г / ${stats.dailyFats}г\n`;
        message += `🍞 Углеводы: ${stats.carbs.toFixed(1)}г / ${stats.dailyCarbs}г\n\n`;
        
        const remaining = stats.dailyCalories - stats.calories;
        if (remaining > 0) {
          message += `💡 Осталось калорий: ${remaining.toFixed(0)} ккал\n\n`;
          
          // Даем рекомендацию
          const recommendation = generateRecommendation(stats, mealTime);
          if (recommendation) {
            message += `${recommendation}`;
          }
        } else {
          message += `⚠️ Дневная норма превышена на ${Math.abs(remaining).toFixed(0)} ккал`;
        }
      }
      
      await ctx.reply(message);
      
    } catch (error) {
      console.error('Ошибка добавления в дневник:', error);
      await ctx.answerCbQuery('❌ Ошибка при сохранении');
    }
  });
  
  bot.action('cancel_meal', async (ctx) => {
    if (ctx.session) {
      delete ctx.session.pendingMeal;
    }
    await ctx.answerCbQuery('Отменено');
    await ctx.reply('❌ Отменено');
  });
}

function generateRecommendation(stats, lastMealTime) {
  const remaining = stats.dailyCalories - stats.calories;
  const proteinRemaining = stats.dailyProtein - stats.protein;
  const carbsRemaining = stats.dailyCarbs - stats.carbs;
  
  if (lastMealTime === 'dinner') {
    // После ужина обычно не даем рекомендаций
    return null;
  }
  
  let recommendation = '💡 Рекомендация: ';
  
  if (proteinRemaining > 20) {
    recommendation += 'добавь больше белка (курица, рыба, творог). ';
  }
  
  if (carbsRemaining > 50 && lastMealTime !== 'dinner') {
    recommendation += 'Можно сложные углеводы (гречка, овсянка). ';
  }
  
  if (remaining < 300) {
    recommendation += 'Оставшихся калорий хватит на легкий перекус.';
  }
  
  return recommendation;
}
