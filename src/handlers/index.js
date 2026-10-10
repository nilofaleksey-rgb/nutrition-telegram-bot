import { Markup } from 'telegraf';
import { setupProfileHandler } from './profile.js';
import { setupDiaryHandler } from './diary.js';
import { setupPhotoHandler } from './photo.js';
import { setupVoiceHandler } from './voice.js';
import { setupWeightHandler } from './weight.js';
import { setupConsultationHandler } from './consultation.js';

export function setupHandlers(bot) {
  // Обработчик кнопок меню
  bot.hears('📝 Заполнить профиль', (ctx) => setupProfileHandler(ctx));
  bot.hears('👤 Мой профиль', async (ctx) => {
    const { getUserProfile } = await import('../services/user.js');
    const profile = getUserProfile(ctx.from.id);
    
    if (!profile) {
      return ctx.reply('Сначала заполни профиль! Нажми "📝 Заполнить профиль"');
    }

    const message = `
👤 Твой профиль:

📏 Рост: ${profile.height} см
⚖️ Текущий вес: ${profile.weight} кг
🎯 Целевой вес: ${profile.goal_weight} кг
👤 Пол: ${profile.gender === 'male' ? 'Мужской' : 'Женский'}
🎂 Возраст: ${profile.age} лет

📊 Дневная норма:
🔥 ${profile.daily_calories} ккал
🥩 Белки: ${profile.daily_protein}г
🧈 Жиры: ${profile.daily_fats}г
🍞 Углеводы: ${profile.daily_carbs}г
`;

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Изменить профиль', 'edit_profile')]
    ]));
  });

  bot.hears('📊 Дневник питания', (ctx) => setupDiaryHandler(ctx));
  bot.hears('📸 Анализ еды', (ctx) => {
    ctx.reply('📸 Отправь фото блюда, и я проанализирую его состав и калорийность!');
  });
  bot.hears('⚖️ Замер веса', (ctx) => setupWeightHandler(ctx));
  bot.hears('💬 Консультация', (ctx) => setupConsultationHandler(ctx));

  // Обработчик фото
  bot.on('photo', setupPhotoHandler);

  // Обработчик голосовых сообщений
  bot.on('voice', setupVoiceHandler);

  // Обработчик текстовых сообщений (консультации)
  bot.on('text', async (ctx) => {
    // Если сообщение начинается с команды или это нажатие кнопки, пропускаем
    if (ctx.message.text.startsWith('/') || ctx.message.text.includes('📝') || 
        ctx.message.text.includes('📊') || ctx.message.text.includes('📸') ||
        ctx.message.text.includes('⚖️') || ctx.message.text.includes('💬')) {
      return;
    }

    // Иначе считаем это консультационным вопросом
    await setupConsultationHandler(ctx, ctx.message.text);
  });
}
