import { Telegraf, Markup, session } from 'telegraf';
import dotenv from 'dotenv';
import { setupDatabase } from './database/db.js';
import { setupCommands } from './commands/index.js';
import { setupHandlers } from './handlers/index.js';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Инициализация базы данных
setupDatabase();

// Session middleware
bot.use(session());

// Установка команд и обработчиков
setupCommands(bot);
setupHandlers(bot);

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('Ошибка в боте:', err);
  ctx.reply('Произошла ошибка. Попробуйте еще раз или обратитесь в поддержку.');
});

// Запуск бота
bot.launch()
  .then(() => {
    console.log('🤖 Бот запущен успешно!');
  })
  .catch((err) => {
    console.error('Ошибка при запуске бота:', err);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
