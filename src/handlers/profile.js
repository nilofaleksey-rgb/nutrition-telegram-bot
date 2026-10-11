import { Markup } from 'telegraf';
import { createUser } from '../services/user.js';

const profileStates = new Map();

export async function setupProfileHandler(ctx) {
  const userId = ctx.from.id;
  profileStates.set(userId, { step: 'height' });
  await ctx.reply('📏 Введи свой рост в сантиметрах (например, 175):');
}

export async function handleProfileText(ctx) {
  const userId = ctx.from.id;
  const state = profileStates.get(userId);
  if (!state) return false;
  if (!ctx.message?.text) return false;

  const text = ctx.message.text.trim();

  try {
    switch (state.step) {
      case 'height': {
        const height = parseInt(text, 10);
        if (Number.isNaN(height) || height < 50 || height > 250) {
          await ctx.reply('❌ Некорректный рост. Введи число от 50 до 250 см:');
          return true;
        }
        state.height = height;
        state.step = 'weight';
        await ctx.reply('⚖️ Введи свой текущий вес в килограммах (например, 70.5):');
        return true;
      }
      case 'weight': {
        const weight = parseFloat(text);
        if (Number.isNaN(weight) || weight < 20 || weight > 300) {
          await ctx.reply('❌ Некорректный вес. Введи число от 20 до 300 кг:');
          return true;
        }
        state.weight = weight;
        state.step = 'gender';
        await ctx.reply('👤 Выбери свой пол:',
          Markup.inlineKeyboard([
            [Markup.button.callback('👨 Мужской', 'gender_male'), Markup.button.callback('👩 Женский', 'gender_female')]
          ]));
        return true;
      }
      case 'age': {
        const age = parseInt(text, 10);
        if (Number.isNaN(age) || age < 10 || age > 120) {
          await ctx.reply('❌ Некорректный возраст. Введи число от 10 до 120 лет:');
          return true;
        }
        state.age = age;
        state.step = 'goal';
        await ctx.reply('🎯 Введи желаемый вес (целевой вес в кг):');
        return true;
      }
      case 'goal': {
        const goalWeight = parseFloat(text);
        if (Number.isNaN(goalWeight) || goalWeight < 20 || goalWeight > 300) {
          await ctx.reply('❌ Некорректный целевой вес. Введи число от 20 до 300 кг:');
          return true;
        }
        state.goal_weight = goalWeight;
        const dailyNutrition = calculateDailyNutrition(state);
        await createUser({
          user_id: userId,
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          height: state.height,
          weight: state.weight,
          gender: state.gender,
          age: state.age,
          goal_weight: state.goal_weight,
          ...dailyNutrition
        });
        profileStates.delete(userId);
        await ctx.reply(
          `✅ Профиль создан успешно!\n\n📊 Твоя дневная норма:\n🔥 Калории: ${dailyNutrition.daily_calories} ккал\n🥩 Белки: ${dailyNutrition.daily_protein}г\n🧈 Жиры: ${dailyNutrition.daily_fats}г\n🍞 Углеводы: ${dailyNutrition.daily_carbs}г\n\nТеперь можешь начать вести дневник питания! 📝`,
          Markup.keyboard([
            ['📊 Дневник питания', '📸 Анализ еды'],
            ['⚖️ Замер веса', '💬 Консультация'],
            ['👤 Мой профиль', '📈 Отчеты']
          ]).resize()
        );
        return true;
      }
      default:
        return false;
    }
  } catch (error) {
    console.error('Ошибка при обработке профиля:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуй еще раз.');
    return true;
  }
}

export function setupGenderCallback(bot) {
  bot.action(/gender_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    const state = profileStates.get(userId);
    if (!state) return ctx.answerCbQuery('Сначала начни заполнение профиля');
    state.gender = ctx.match[1];
    state.step = 'age';
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Пол выбран\n\n🎂 Теперь введи свой возраст (полных лет):`);
  });
}

function calculateDailyNutrition(profile) {
  const { weight, height, age, gender, goal_weight } = profile;
  const bmr = gender === 'male'
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;
  const tdee = bmr * 1.375;
  const dailyCalories = goal_weight < weight ? Math.round(tdee * 0.8) : goal_weight > weight ? Math.round(tdee * 1.1) : Math.round(tdee);
  const daily_protein = Math.round(weight * 1.8);
  const daily_fats = Math.round((dailyCalories * 0.25) / 9);
  const carbsCalories = dailyCalories - daily_protein * 4 - daily_fats * 9;
  const daily_carbs = Math.round(carbsCalories / 4);
  return { daily_calories: dailyCalories, daily_protein, daily_fats, daily_carbs };
}
