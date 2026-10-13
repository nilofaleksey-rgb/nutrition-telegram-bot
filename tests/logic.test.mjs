import dotenv from 'dotenv';
dotenv.config();

import { extractFoodFromText, getConsultation, shortRecommendation, aiStatus } from '../src/services/ai.js';

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`);
};

console.log('=== Статус AI ===');
console.log(JSON.stringify(aiStatus()));

console.log('\n=== 1. Распознавание еды из текста (через бесплатный AI) ===');
const foods = [
  'съел гречку с курицей 250 г',
  'на завтрак овсянка с бананом',
  'выпил кофе с молоком'
];
for (const text of foods) {
  try {
    const r = await extractFoodFromText(text);
    const valid = r && Number.isFinite(r.calories) && r.calories > 0 && r.food_name;
    check(`"${text}"`, valid, valid ? `${r.food_name} — ${r.calories} ккал (Б${r.protein} Ж${r.fats} У${r.carbs})` : JSON.stringify(r));
  } catch (e) {
    check(`"${text}"`, false, e.message);
  }
}

console.log('\n=== 2. Локальная база (fallback без сети) ===');
const local = await extractFoodFromText('гречка 150 г');
check('Локальная база отвечает', Boolean(local?.calories > 0), `${local?.food_name} — ${local?.calories} ккал`);

console.log('\n=== 3. Консультация диетолога ===');
const profile = { height: 180, weight: 90, goal_weight: 80, age: 30, gender: 'male', daily_calories: 2200, daily_protein: 162, daily_fats: 61, daily_carbs: 200 };
const stats = { calories: 1200, protein: 80, fats: 40, carbs: 120, dailyCalories: 2200, dailyProtein: 162, dailyFats: 61, dailyCarbs: 200 };

for (const q of ['Что лучше съесть на завтрак?', 'Как похудеть без потери мышц?']) {
  try {
    const r = await getConsultation({ question: q, profile, todayStats: stats });
    check(`Вопрос: "${q}"`, Boolean(r?.short && r?.detailed), `короткий: ${String(r?.short).slice(0, 90)}...`);
  } catch (e) {
    check(`Вопрос: "${q}"`, false, e.message);
  }
}

console.log('\n=== 4. Рекомендация после еды ===');
const rec = shortRecommendation(stats, 'lunch');
check('Рекомендация генерируется', Boolean(rec), rec);

const recOver = shortRecommendation({ ...stats, calories: 2500 }, 'dinner');
check('Предупреждение о превышении', /превышен/i.test(recOver || ''), recOver);

console.log('\n=== ИТОГО ===');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);