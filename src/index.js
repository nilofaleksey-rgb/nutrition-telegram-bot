import { Telegraf, session } from 'telegraf';
import dotenv from 'dotenv';
import { setupDatabase } from './database/db.js';
import { setupCommands } from './commands/index.js';
import { setupHandlers } from './handlers/index.js';
import { aiStatus } from './services/ai.js';

dotenv.config();

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Не задан TELEGRAM_BOT_TOKEN. Добавь его в переменные окружения.');
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

await setupDatabase();

bot.use(session());

setupCommands(bot);
setupHandlers(bot);

bot.catch((err, ctx) => {
  console.error('Ошибка в боте:', err);
  ctx.reply('⚠️ Произошла ошибка. Попробуй ещё раз.').catch(() => {});
});

const shutdown = (signal) => bot.stop(signal);
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

bot.launch()
  .then(async () => {
    const me = await bot.telegram.getMe().catch(() => null);
    const ai = aiStatus();
    console.log('🤖 Бот запущен успешно!');
    if (me) console.log(`   @${me.username} (${me.first_name})`);
    console.log(`   Gemini (фото/голос/умные ответы): ${ai.gemini ? '✅ подключён' : '⚠️ ключ не задан'}`);
    console.log('   Текстовый AI без ключа (Pollinations): ✅ доступен');
    console.log('   Локальная база продуктов: ✅ доступна');
  })
  .catch((err) => {
    console.error('Ошибка при запуске бота:', err);
    process.exit(1);
  });