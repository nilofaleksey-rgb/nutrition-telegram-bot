import dotenv from 'dotenv';
dotenv.config();
import { setupDatabase } from '../src/database/db.js';
import { addMemory, deleteMemory, deleteAllFeedback, getSafeConsultation } from '../src/services/feedback.js';
import { getConsultation } from '../src/services/ai.js';

const U = 777777777;
const results = [];
const check = (n, ok, info = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${info ? ' — ' + info : ''}`); };

const profile = { height: 180, weight: 90, goal_weight: 80, age: 30, gender: 'male', daily_calories: 2200, daily_protein: 162, daily_fats: 61, daily_carbs: 200 };
const stats = { calories: 1200, protein: 80, fats: 40, carbs: 120, dailyCalories: 2200, dailyProtein: 162, dailyFats: 61, dailyCarbs: 200 };

(async () => {
  await setupDatabase();
  await deleteMemory(U);
  await deleteAllFeedback(U);

  await addMemory(U, 'не ем свинину');
  await addMemory(U, 'аллергия на орехи');
  await addMemory(U, 'безлактозная диета');

  console.log('=== Проверка защиты на 3 вопросах ===\n');

  const questions = [
    'Что съесть на ужин?',
    'Посоветуй перекус',
    'Что добавить в рацион для белка?'
  ];

  for (const q of questions) {
    console.log(`--- ${q} ---`);
    const { response, violations } = await getSafeConsultation({
      question: q, profile, todayStats: stats, userId: U, getConsultationFn: getConsultation
    });

    const full = `${response.short} ${response.detailed}`.toLowerCase();
    const hasPork = /свинин/.test(full);
    const hasNuts = /орех/.test(full);
    const hasDairy = /(молок|творог|сыр|кефир|йогурт)/.test(full);

    console.log(`   Кратко: ${response.short.slice(0, 100)}`);
    console.log(`   Упоминания → свинина: ${hasPork}, орехи: ${hasNuts}, молочка: ${hasDairy}`);
    console.log(`   Нарушений после защиты: ${violations.length}`);

    check(`"${q}" — без нарушений`, violations.length === 0,
      violations.length ? violations.map(v => v.food).join(', ') : 'чисто');
    console.log('');
  }

  console.log('=== Проверка, что запреты соблюдены во ВСЕХ ответах ===');
  const allClean = results.every(Boolean);
  check('Все ответы учитывают ограничения', allClean);

  await deleteMemory(U);
  await deleteAllFeedback(U);

  console.log('\n=== ИТОГО ===');
  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} проверок пройдено`);
  process.exit(passed === results.length ? 0 : 1);
})();