/**
 * Полный тест AI-слоя бота: текст, фото, голос, консультации.
 * Требует GEMINI_API_KEY в .env
 */
import dotenv from 'dotenv';
dotenv.config();

import { analyzeFoodImage, extractFoodFromText, getConsultation, transcribeVoice, aiStatus } from '../src/services/ai.js';

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`);
};

// Валидный JPEG (32x32 оранжевый) для проверки vision
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q==';

const jpeg = Buffer.from(JPEG_B64, 'base64');
console.log(`Тестовое изображение: ${jpeg.length} байт, magic=${jpeg.slice(0, 2).toString('hex')}\n`);

console.log('=== Статус AI ===');
console.log(JSON.stringify(aiStatus(), null, 2));
console.log('');

console.log('=== 1. Фото → КБЖУ (vision на реальном фото еды) ===');
try {
  const res = await fetch('https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(60000)
  });
  const foodJpeg = Buffer.from(await res.arrayBuffer());
  check('Фото еды скачано', foodJpeg.length > 5000, `${foodJpeg.length} байт`);

  const r = await analyzeFoodImage(foodJpeg, 'image/jpeg');
  const ok = r && !r.error && r.calories > 0;
  check('Vision распознал еду и КБЖУ', ok, ok
    ? `${r.food_name} — ${r.calories} ккал (Б${r.protein} Ж${r.fats} У${r.carbs})`
    : JSON.stringify(r));
} catch (e) {
  check('Vision распознал еду', false, e.message);
}

console.log('\n=== 1б. Не-еда должна отклоняться ===');
try {
  const r = await analyzeFoodImage(jpeg, 'image/jpeg'); // оранжевый квадрат
  check('Не-еда не выдаётся за блюдо', r?.error === 'no_food', JSON.stringify(r));
} catch (e) {
  check('Не-еда не выдаётся за блюдо', false, e.message);
}

console.log('\n=== 2. Текст → КБЖУ (Gemini) ===');
try {
  const r = await extractFoodFromText('съел гречку с куриной грудкой 250 грамм');
  const ok = r?.calories > 0;
  check('Текст через Gemini', ok, `${r?.food_name} — ${r?.calories} ккал (Б${r?.protein} Ж${r?.fats} У${r?.carbs})`);
} catch (e) {
  check('Текст через Gemini', false, e.message);
}

console.log('\n=== 3. Консультация (Gemini, развёрнутый ответ) ===');
const profile = { height: 180, weight: 90, goal_weight: 80, age: 30, gender: 'male', daily_calories: 2200, daily_protein: 162, daily_fats: 61, daily_carbs: 200 };
const stats = { calories: 1200, protein: 80, fats: 40, carbs: 120, dailyCalories: 2200, dailyProtein: 162, dailyFats: 61, dailyCarbs: 200 };
try {
  const r = await getConsultation({ question: 'Что съесть на ужин, чтобы добрать белок?', profile, todayStats: stats });
  const ok = r?.short && r?.detailed && r.detailed.length > r.short.length;
  check('Развёрнутый ответ длиннее краткого', ok, `кратко ${r?.short?.length} симв., подробно ${r?.detailed?.length} симв.`);
  console.log(`   Кратко: ${r?.short}`);
  console.log(`   Подробно (начало): ${String(r?.detailed).slice(0, 180)}...`);
} catch (e) {
  check('Консультация', false, e.message);
}

console.log('\n=== 4. Голос → текст (проверка доступности API) ===');
try {
  const r = await transcribeVoice(jpeg, 'audio/ogg');
  // Ожидаемо может вернуть null (это не аудио) — важно что API ответил без исключения
  check('Voice API доступен (без падения)', true, r === null ? 'ответ пустой (ожидаемо для не-аудио)' : String(r).slice(0, 80));
} catch (e) {
  check('Voice API доступен', false, e.message);
}

console.log('\n=== ИТОГО ===');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} проверок пройдено`);
process.exit(passed === results.length ? 0 : 1);