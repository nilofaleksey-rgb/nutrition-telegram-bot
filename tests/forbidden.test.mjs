import dotenv from 'dotenv';
dotenv.config();
import { findViolations, getForbiddenFoods } from '../src/services/feedback.js';
import { addMemory, deleteMemory } from '../src/services/feedback.js';
import { setupDatabase } from '../src/database/db.js';

const U = 888888888;
const results = [];
const check = (n, ok, info = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${info ? ' — ' + info : ''}`); };

(async () => {
  await setupDatabase();
  await deleteMemory(U);

  console.log('=== 1. Извлечение запретов из памяти ===');
  await addMemory(U, 'не ем свинину');
  await addMemory(U, 'аллергия на орехи');
  const forbidden = await getForbiddenFoods(U);
  console.log('Запрещено:', forbidden.join(', '));
  check('Свинина в запретах', forbidden.some(f => 'свинин'.includes(f) || f.includes('свинин')));
  check('Орехи в запретах', forbidden.some(f => 'орех'.includes(f) || f.includes('орех')));

  console.log('\n=== 2. Детектор нарушений ===');
  const bad = 'На ужин отлично подойдёт свинина с овощами, а на десерт горсть орехов.';
  const v1 = findViolations(bad, forbidden);
  check('Нарушение найдено в плохом ответе', v1.length >= 2, `найдено: ${v1.map(v => v.food).join(', ')}`);

  const good = 'Избегаем свинину и орехи из-за аллергии. На ужин — индейка с овощами.';
  const v2 = findViolations(good, forbidden);
  check('Правильный ответ не считается нарушением', v2.length === 0, `найдено: ${v2.length}`);

  const replace = 'Вместо свинины можно взять индейку, а вместо орехов — семечки.';
  const v3 = findViolations(replace, forbidden);
  check('Замена ("вместо") не нарушение', v3.length === 0, `найдено: ${v3.length}`);

  const taboo = 'Табу: свинину не едим, орехи исключаем полностью.';
  const v4 = findViolations(taboo, forbidden);
  check('Напоминание о табу не нарушение', v4.length === 0, `найдено: ${v4.length}`);

  console.log('\n=== 3. Лактоза разворачивается в продукты ===');
  await deleteMemory(U);
  await addMemory(U, 'безлактозная диета, не переношу лактозу');
  const f2 = await getForbiddenFoods(U);
  console.log('Запрещено:', f2.join(', '));
  check('Молоко в запретах', f2.some(f => f.includes('молок')));
  check('Творог в запретах', f2.some(f => f.includes('творог')));
  check('Сыр в запретах', f2.some(f => f.includes('сыр')));

  console.log('\n=== 4. Обычные заметки не создают запретов ===');
  await deleteMemory(U);
  await addMemory(U, 'тренируюсь 3 раза в неделю');
  const f3 = await getForbiddenFoods(U);
  check('Спорт-заметка не создаёт запретов', f3.length === 0, `запретов: ${f3.length}`);

  await deleteMemory(U);

  console.log('\n=== ИТОГО ===');
  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} проверок пройдено`);
  process.exit(passed === results.length ? 0 : 1);
})();