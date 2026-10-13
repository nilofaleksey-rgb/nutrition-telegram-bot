import { Markup } from 'telegraf';
import {
  addFeedback,
  getFeedback,
  addMemory,
  getMemory,
  deleteMemory,
  deleteAllFeedback
} from '../services/feedback.js';

/** Кнопка «есть замечания», добавляемая к результатам. */
export function feedbackRow(context = 'general') {
  return [
    Markup.button.callback('✏️ Есть замечания', `fb_${context}`),
    Markup.button.callback('💡 Что бот помнит', 'fb_memory')
  ];
}

/** Переводит режим в ожидание текста замечания. */
export async function startFeedback(ctx, context = 'general') {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingFeedback = true;
  ctx.session.feedbackContext = context;

  await ctx.reply(
    '✏️ Напиши замечание — что не так и как правильно.\n\n' +
    'Я это запомню и буду учитывать в следующих ответах.\n' +
    'Например: «в гречке не 330 ккал, а 110 — укажи готовую»\n' +
    'или «я не ем свинину».\n\n' +
    'Отмена — /reset'
  );
}

/** Сохраняет замечание и пытается понять, что запомнить. */
export async function handleFeedbackText(ctx) {
  if (!ctx.session?.awaitingFeedback) return false;

  const text = (ctx.message?.text || '').trim();
  if (!text) return false;

  const userId = ctx.from.id;
  const context = ctx.session.feedbackContext || 'general';

  delete ctx.session.awaitingFeedback;
  delete ctx.session.feedbackContext;

  try {
    await addFeedback({ userId, message: text, context });

    // Пытаемся вытащить долговременный факт (аллергии, предпочтения, запреты)
    const memoryNote = extractMemoryNote(text);
    let memorized = false;
    if (memoryNote) {
      memorized = await addMemory(userId, memoryNote);
    }

    let message = '✅ Замечание сохранено. Учту в следующих ответах.\n\n';
    if (memorized) {
      message += `🧠 Также запомнил навсегда: «${memoryNote}»\n\n`;
    }
    message += `📌 Всего замечаний: ${(await getFeedback(userId, 100)).length}`;

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('💡 Что бот помнит', 'fb_memory')]
    ]));
  } catch (error) {
    console.error('Ошибка сохранения замечания:', error);
    await ctx.reply('❌ Не удалось сохранить замечание. Попробуй ещё раз.');
  }

  return true;
}

/** Выделяет из текста факт, который стоит запомнить навсегда. */
function extractMemoryNote(text) {
  const lower = text.toLowerCase();

  // Аллергии, непереносимость, запреты — самое важное
  const allergy = text.match(/(аллерг\w*|не перенош\w*|непереносимост\w*|не ем|не люблю|нельзя|исключ\w*)\s*([^.,;!?]{2,60})/i);
  if (allergy) return text.slice(0, 200);

  // Явные предпочтения
  if (/(вегетариан|веган|халяль|кошер|безлактоз|без глютен|диабет|подагр|гастрит|холестерин)/i.test(lower)) {
    return text.slice(0, 200);
  }

  // Явные цели и привычки
  if (/(я предпочитаю|мой график|тренируюсь|работаю|сплю|пью|придерживаюсь)/i.test(lower)) {
    return text.slice(0, 200);
  }

  // Правки по калорийности/продуктам тоже полезно помнить
  if (/(ккал|калорий|бжу|белк|жир|углевод|грамм|вес порции)/i.test(lower)) {
    return text.slice(0, 200);
  }

  return null;
}

export function setupFeedbackCallbacks(bot) {
  // Кнопка «Есть замечания»
  bot.action(/^fb_(?!memory|list|clear|del)(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await startFeedback(ctx, ctx.match[1]);
  });

  // Что бот помнит
  bot.action('fb_memory', async (ctx) => {
    const userId = ctx.from.id;
    const [memory, feedback] = await Promise.all([getMemory(userId, 30), getFeedback(userId, 10)]);

    await ctx.answerCbQuery();

    let message = '🧠 Что я помню о тебе:\n\n';

    if (memory.length) {
      memory.forEach((m, i) => { message += `${i + 1}. ${m.note}\n`; });
    } else {
      message += '— пока ничего не запомнил\n';
    }

    if (feedback.length) {
      message += '\n📝 Последние замечания к ответам:\n';
      feedback.slice(0, 5).forEach((f) => {
        const date = new Date(f.created_at).toLocaleDateString('ru-RU');
        message += `• ${date}: ${String(f.message).slice(0, 80)}\n`;
      });
    }

    const buttons = [];
    if (memory.length) {
      memory.slice(0, 5).forEach((m) => {
        buttons.push([Markup.button.callback(`❌ ${String(m.note).slice(0, 40)}`, `fb_del_${m.id}`)]);
      });
      buttons.push([Markup.button.callback('🗑 Очистить всю память', 'fb_clear')]);
    }

    await ctx.reply(message, buttons.length ? Markup.inlineKeyboard(buttons) : undefined);
  });

  // Удалить конкретный факт из памяти
  bot.action(/^fb_del_(\d+)$/, async (ctx) => {
    await deleteMemory(ctx.from.id, parseInt(ctx.match[1], 10));
    await ctx.answerCbQuery('🗑 Удалено');
    await ctx.reply('🗑 Удалено из памяти.');
  });

  // Очистить всю память и замечания
  bot.action('fb_clear', async (ctx) => {
    await deleteMemory(ctx.from.id);
    await deleteAllFeedback(ctx.from.id);
    await ctx.answerCbQuery('Очищено');
    await ctx.reply('🗑 Память и замечания очищены.');
  });
}