import dotenv from 'dotenv';
dotenv.config();

import { addFeedback, getFeedback, addMemory, getMemory, getPersonalContext, deleteMemory, deleteAllFeedback } from '../src/services/feedback.js';
import { getConsultation } from '../src/services/ai.js';
import { setupDatabase } from '../src/database/db.js';

const TEST_USER = 999999999;
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`);
};

(async () => {
  await setupDatabase();

  // Чистим перед тестом
  await deleteMemory(TEST_USER);
  await deleteAllFeedback(TEST_USER);

  console.log('=== 1. Сохранение замечания ===');
  await addFeedback({ userId: TEST_USER, message: 'в гречке не 330 ккал, а 110', context: 'food' });
  const feedback = await getFeedback(TEST_USER);
  check('Замечание сохранено', feedback.length === 1, `записей: ${feedback.length}`);
  check('Текст замечания верный', feedback[0]?.message?.includes('гречке'), feedback[0]?.message);

  console.log('\n=== 2. Память о пользователе ===');
  const added1 = await addMemory(TEST_USER, 'не ем свинину');
  const added2 = await addMemory(TEST_USER, 'не ем свинину'); // дубликат
  const memory = await getMemory(TEST_USER);
  check('Факт записан', added1 === true);
  check('Дубликат не записан', added2 === false);
  check('В памяти 1 факт', memory.length === 1, `фактов: ${memory.length}`);

  await addMemory(TEST_USER, 'аллергия на орехи');
  const memory2 = await getMemory(TEST_USER);
  check('Второй факт добавлен', memory2.length === 2, `фактов: ${memory2.length}`);

  console.log('\n=== 3. Контекст для AI формируется ===');
  const ctx = await getPersonalContext(TEST_USER);
  check('Контекст содержит память', ctx.includes('свинин'), ctx.slice(0, 120).replace(/\n/g, ' '));
  check('Контекст содержит замечание', ctx.includes('гречке'));
  check('Контекст с заголовками', ctx.includes('известно о пользователе') && ctx.includes('замечания'));

  console.log('\n=== 4. Память учитывается в консультации ===');
  const profile = { height: 180, weight: 90, goal_weight: 80, age: 30, gender: 'male', daily_calories: 2200, daily_protein: 162, daily_fats: 61, daily_carbs: 200 };
  const stats = { calories: 1200, protein: 80, fats: 40, carbs: 120, dailyCalories: 2200, dailyProtein: 162, dailyFats: 61, dailyCarbs: 200 };

  const withMemory = await getConsultation({ question: 'Что съесть на ужин?', profile, todayStats: stats, personalContext: ctx });
  const without = await getConsultation({ question: 'Что съесть на ужин?', profile, todayStats: stats, personalContext: '' });

  check('Ответ с памятью получен', Boolean(withMemory?.short));
  check('Ответ без памяти получен', Boolean(without?.short));

  const full = (withMemory.short + ' ' + withMemory.detailed).toLowerCase();
  const mentionsPork = /свинин/i.test(full);

  // Если свинина упомянута — она должна быть в запрещающем/исключающем контексте
  const forbiddenContext = /(избега\w+|исключ\w+|не\s+(едим|ем|рекоменд\w*|употребля\w*)|без\s+свинин|вместо\s+свинин|замен\w*\s+свинин)/i
    .test(full);

  check(
    'Бот учитывает запрет на свинину',
    !mentionsPork || forbiddenContext,
    mentionsPork
      ? (forbiddenContext ? 'свинина упомянута как запрещённая (верно)' : '⚠️ свинина предложена как еда')
      : 'свинина не упоминается'
  );

  // Аллергия на орехи тоже должна учитываться
  const mentionsNuts = /орех/i.test(full);
  const nutsForbidden = /(избега\w+|исключ\w+|не\s+(едим|ем|рекоменд\w*)|без\s+орех|аллерг)/i.test(full);
  check(
    'Бот учитывает аллергию на орехи',
    !mentionsNuts || nutsForbidden,
    mentionsNuts ? (nutsForbidden ? 'орехи упомянуты как запрещённые (верно)' : '⚠️ орехи предложены') : 'орехи не упоминаются'
  );

  // Правка про калорийность гречки должна быть учтена
  const buckwheatMention = full.match(/(\d+)\s*ккал[^.]{0,40}гречк|гречк[^.]{0,40}(\d+)\s*ккал/i);
  check(
    'Бот помнит правку про гречку (110 ккал)',
    !buckwheatMention || buckwheatMention[0].includes('110'),
    buckwheatMention ? `упоминание: "${buckwheatMention[0].slice(0, 60)}"` : 'гречка в ответе не упоминалась'
  );

  console.log('\n=== 5. Удаление памяти ===');
  const before = (await getMemory(TEST_USER)).length;
  await deleteMemory(TEST_USER, memory[0].id);
  const after = (await getMemory(TEST_USER)).length;
  check('Один факт удалён', after === before - 1, `${before} → ${after}`);

  await deleteMemory(TEST_USER);
  await deleteAllFeedback(TEST_USER);
  const cleared = await getMemory(TEST_USER);
  check('Вся память очищена', cleared.length === 0);
  check('Замечания очищены', (await getFeedback(TEST_USER)).length === 0);

  console.log('\n=== ИТОГО ===');
  const passed = results.filter(r => r.ok).length;
  console.log(`${passed}/${results.length} проверок пройдено`);
  process.exit(passed === results.length ? 0 : 1);
})();