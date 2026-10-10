import { Markup } from 'telegraf';
import { createUser, updateUser, getUserProfile } from '../services/user.js';

const profileStates = new Map();

export async function setupProfileHandler(ctx) {
  const userId = ctx.from.id;
  
  profileStates.set(userId, { step: 'height' });
  
  await ctx.reply('📏 Введи свой рост в сантиметрах (например, 175):');
  
  // Устанавливаем обработчик для ввода данных
  return setupProfileInput(ctx);
}

async function setupProfileInput(ctx) {
  const userId = ctx.from.id;
  
  // Создаем обработчик текста для этого пользователя
  const textHandler = async (context) => {
    if (context.from.id !== userId) return;
    
    const state = profileStates.get(userId);
    if (!state) return;
    
    const text = context.message.text;
    
    try {
      switch (state.step) {
        case 'height':
          const height = parseInt(text);
          if (isNaN(height) || height < 50 || height > 250) {
            return context.reply('❌ Некорректный рост. Введи число от 50 до 250 см:');
          }
          state.height = height;
          state.step = 'weight';
          return context.reply('⚖️ Введи свой текущий вес в килограммах (например, 70.5):');
        
        case 'weight':
          const weight = parseFloat(text);
          if (isNaN(weight) || weight < 20 || weight > 300) {
            return context.reply('❌ Некорректный вес. Введи число от 20 до 300 кг:');
          }
          state.weight = weight;
          state.step = 'gender';
          return context.reply('👤 Выбери свой пол:', 
            Markup.inlineKeyboard([
              [Markup.button.callback('👨 Мужской', 'gender_male'),
               Markup.button.callback('👩 Женский', 'gender_female')]
            ])
          );
        
        case 'age':
          const age = parseInt(text);
          if (isNaN(age) || age < 10 || age > 120) {
            return context.reply('❌ Некорректный возраст. Введи число от 10 до 120 лет:');
          }
          state.age = age;
          state.step = 'goal';
          return context.reply('🎯 Введи желаемый вес (целевой вес в кг):');
        
        case 'goal':
          const goalWeight = parseFloat(text);
          if (isNaN(goalWeight) || goalWeight < 20 || goalWeight > 300) {
            return context.reply('❌ Некорректный целевой вес. Введи число от 20 до 300 кг:');
          }
          state.goal_weight = goalWeight;
          
          // Рассчитываем дневную норму КБЖУ
          const dailyNutrition = calculateDailyNutrition(state);
          
          // Сохраняем профиль
          createUser({
            user_id: userId,
            username: context.from.username,
            first_name: context.from.first_name,
            height: state.height,
            weight: state.weight,
            gender: state.gender,
            age: state.age,
            goal_weight: state.goal_weight,
            ...dailyNutrition
          });
          
          profileStates.delete(userId);
          
          const message = `
✅ Профиль создан успешно!

📊 Твоя дневная норма:
🔥 Калории: ${dailyNutrition.daily_calories} ккал
🥩 Белки: ${dailyNutrition.daily_protein}г
🧈 Жиры: ${dailyNutrition.daily_fats}г
🍞 Углеводы: ${dailyNutrition.daily_carbs}г

Теперь можешь начать вести дневник питания! 📝
`;
          
          return context.reply(message, 
            Markup.keyboard([
              ['📊 Дневник питания', '📸 Анализ еды'],
              ['⚖️ Замер веса', '💬 Консультация'],
              ['👤 Мой профиль', '📈 Отчеты']
            ]).resize()
          );
      }
    } catch (error) {
      console.error('Ошибка при обработке профиля:', error);
      context.reply('❌ Произошла ошибка. Попробуй еще раз.');
    }
  };
  
  ctx.telegram.on('text', textHandler);
}

// Обработчик выбора пола
export function setupGenderCallback(bot) {
  bot.action(/gender_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    const state = profileStates.get(userId);
    
    if (!state) return;
    
    const gender = ctx.match[1]; // 'male' или 'female'
    state.gender = gender;
    state.step = 'age';
    
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Пол: ${gender === 'male' ? 'Мужской' : 'Женский'}\n\n🎂 Теперь введи свой возраст (полных лет):`);
  });
}

// Формула Миффлина-Сан Жеора для расчета базового метаболизма
function calculateDailyNutrition(profile) {
  const { weight, height, age, gender, goal_weight } = profile;
  
  // Базовый метаболизм (BMR)
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }
  
  // Умножаем на коэффициент активности (средний уровень)
  const tdee = bmr * 1.375;
  
  // Определяем дефицит/профицит калорий в зависимости от цели
  let dailyCalories;
  if (goal_weight < weight) {
    // Похудение: дефицит 20%
    dailyCalories = Math.round(tdee * 0.8);
  } else if (goal_weight > weight) {
    // Набор: профицит 10%
    dailyCalories = Math.round(tdee * 1.1);
  } else {
    // Поддержание
    dailyCalories = Math.round(tdee);
  }
  
  // Рассчитываем БЖУ
  const proteinGramsPerKg = 1.8; // г на кг веса
  const fatsPercentage = 0.25; // 25% от калорий
  
  const daily_protein = Math.round(weight * proteinGramsPerKg);
  const daily_fats = Math.round((dailyCalories * fatsPercentage) / 9); // 9 ккал в грамме жира
  const proteinCalories = daily_protein * 4;
  const fatsCalories = daily_fats * 9;
  const carbsCalories = dailyCalories - proteinCalories - fatsCalories;
  const daily_carbs = Math.round(carbsCalories / 4); // 4 ккал в грамме углеводов
  
  return {
    daily_calories: dailyCalories,
    daily_protein,
    daily_fats,
    daily_carbs
  };
}
