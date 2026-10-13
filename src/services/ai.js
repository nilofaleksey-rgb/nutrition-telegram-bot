/**
 * AI-слой бота. Работает БЕЗ OpenAI.
 *
 * Провайдеры (в порядке приоритета):
 *  1. Google Gemini — бесплатный тир, умеет фото, голос и текст (нужен бесплатный ключ)
 *  2. Pollinations.ai — полностью бесплатный текст БЕЗ ключа (fallback)
 *  3. Локальная база продуктов — если нейросети недоступны
 */

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

/** Читаем ключ лениво: .env загружается уже после импорта модулей. */
function getGeminiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

/**
 * Модели перебираются по порядку, пока одна не ответит.
 * Проверено практикой на ключе проекта:
 *  - gemini-3.5-flash-lite / gemini-flash-lite-latest — стабильны для текста И фото
 *  - gemini-3-flash-preview, gemini-3.8-flash и др. часто отдают 503/429
 */
function getGeminiModels() {
  return [
    process.env.GEMINI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-3.6-flash'
  ].filter(Boolean);
}

/** Сколько раз повторять запрос при перегрузке (503/429). */
const RETRY_ATTEMPTS = 3;

let activeGeminiModel = null;

export function hasGemini() {
  return Boolean(getGeminiKey());
}

export function aiStatus() {
  const has = Boolean(getGeminiKey());
  return {
    gemini: has,
    vision: has,
    voice: has,
    textFallback: true,
    model: activeGeminiModel || (has ? 'gemini (auto)' : 'pollinations')
  };
}

/* ------------------------------------------------------------------ */
/* Хелперы                                                             */
/* ------------------------------------------------------------------ */

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function toNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFood(obj, fallbackName = '🍽️ Блюдо') {
  if (!obj || typeof obj !== 'object') return null;
  let name = obj.food_name || obj.name || obj.dish || fallbackName;

  // Убираем английские вставки, которые иногда добавляет модель: "buckwheat 🌾 chicken 🍗"
  name = String(name)
    .replace(/\b(buckwheat|chicken|rice|oatmeal|oat|fish|salmon|tuna|meat|beef|pork|turkey|egg|eggs|omelet|salad|cucumber|tomato|potato|cabbage|carrot|broccoli|cottage\s*cheese|yogurt|milk|kefir|cheese|banana|apple|orange|pear|bread|soup|borscht|pizza|burger|pasta|macaroni|pilaf|coffee|with|and|bowl|sweet\s*potato|chickpea|avocado)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!name) name = fallbackName;

  const calories = toNumber(obj.calories, NaN);
  const protein = toNumber(obj.protein, NaN);
  const fats = toNumber(obj.fats ?? obj.fat, NaN);
  const carbs = toNumber(obj.carbs ?? obj.carbohydrates, NaN);
  if (!Number.isFinite(calories)) return null;

  return {
    food_name: name.slice(0, 120),
    calories: Math.round(calories),
    protein: Math.round((Number.isFinite(protein) ? protein : 0) * 10) / 10,
    fats: Math.round((Number.isFinite(fats) ? fats : 0) * 10) / 10,
    carbs: Math.round((Number.isFinite(carbs) ? carbs : 0) * 10) / 10
  };
}

/** Запрос к Gemini с автоподбором рабочей модели. */
async function gemini(parts, { temperature = 0.4, maxTokens = 1024 } = {}) {
  const key = getGeminiKey();
  if (!key) return null;

  const allModels = getGeminiModels();
  const models = activeGeminiModel
    ? [activeGeminiModel, ...allModels.filter(m => m !== activeGeminiModel)]
    : allModels;

  for (const model of models) {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { temperature, maxOutputTokens: maxTokens }
            }),
            signal: AbortSignal.timeout(90000)
          }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const status = data?.error?.status;
          console.warn(`Gemini ${model} (попытка ${attempt}): HTTP ${res.status} ${status || ''}`);

          // Ключ неверный — нет смысла продолжать
          if (status === 'API_KEY_INVALID' || status === 'PERMISSION_DENIED') return null;

          // Модель недоступна — сразу к следующей
          if (status === 'NOT_FOUND') break;

          // Перегрузка или лимит — ждём и пробуем снова
          if (status === 'UNAVAILABLE' || status === 'RESOURCE_EXHAUSTED' || res.status >= 500) {
            if (attempt < RETRY_ATTEMPTS) {
              await new Promise(r => setTimeout(r, 1200 * attempt));
              continue;
            }
            break;
          }

          break;
        }

        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map(p => p.text)
          .filter(Boolean)
          .join('\n')
          .trim();

        if (text) {
          activeGeminiModel = model;
          return text;
        }
        break;
      } catch (error) {
        console.warn(`Gemini ${model} (попытка ${attempt}) ошибка: ${error.message}`);
        if (attempt < RETRY_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1200 * attempt));
          continue;
        }
      }
    }
  }

  return null;
}

/** Бесплатный текстовый fallback без ключа. */
async function pollinations(messages) {
  for (const model of ['openai-fast', 'openai']) {
    try {
      const res = await fetch(POLLINATIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, referrer: 'nutrition-telegram-bot' }),
        signal: AbortSignal.timeout(90000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch (error) {
      console.warn(`Pollinations ${model} ошибка: ${error.message}`);
    }
  }
  return null;
}

function bufferToBase64(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
}

/* ------------------------------------------------------------------ */
/* Локальная база продуктов (КБЖУ на 100 г)                            */
/* ------------------------------------------------------------------ */

const FOOD_DB = {
  'гречка': ['🌾 Гречка', 110, 4.2, 1.1, 21.3],
  'гречневая каша': ['🌾 Гречневая каша', 110, 4.2, 1.1, 21.3],
  'рис': ['🍚 Рис', 344, 6.7, 0.7, 78.9],
  'рисовая каша': ['🍚 Рисовая каша', 78, 1.5, 0.1, 17.3],
  'овсянка': ['🥣 Овсянка', 342, 12.3, 6.1, 59.5],
  'овсяная каша': ['🥣 Овсяная каша', 88, 3.2, 1.7, 14.2],
  'перловка': ['🌾 Перловка', 320, 9.3, 1.1, 66.9],
  'макароны': ['🍝 Макароны', 158, 5.8, 0.9, 30.9],
  'паста': ['🍝 Паста', 158, 5.8, 0.9, 30.9],
  'курица': ['🍗 Куриная грудка', 165, 31, 3.6, 0],
  'куриная грудка': ['🍗 Куриная грудка', 165, 31, 3.6, 0],
  'куриное филе': ['🍗 Куриное филе', 165, 31, 3.6, 0],
  'говядина': ['🥩 Говядина', 250, 26, 15, 0],
  'свинина': ['🥓 Свинина', 242, 16, 21, 0],
  'индейка': ['🦃 Индейка', 189, 21.6, 12, 0],
  'котлета': ['🍖 Котлета', 260, 18, 20, 4],
  'тефтели': ['🍖 Тефтели', 217, 17, 12, 9],
  'рыба': ['🐟 Рыба', 120, 20, 5, 0],
  'лосось': ['🐟 Лосось', 208, 20, 13, 0],
  'тунец': ['🐟 Тунец', 96, 23, 0.6, 0],
  'минтай': ['🐟 Минтай', 72, 16, 1, 0],
  'салат': ['🥗 Овощной салат', 50, 2, 1, 8],
  'огурец': ['🥒 Огурец', 15, 0.8, 0.1, 2.8],
  'помидор': ['🍅 Помидор', 20, 0.9, 0.2, 4.2],
  'картофель': ['🥔 Картофель', 77, 2, 0.4, 16.3],
  'картошка': ['🥔 Картошка', 77, 2, 0.4, 16.3],
  'капуста': ['🥬 Капуста', 27, 1.8, 0.1, 4.7],
  'морковь': ['🥕 Морковь', 41, 1.3, 0.1, 9.6],
  'брокколи': ['🥦 Брокколи', 34, 2.8, 0.4, 6.6],
  'творог': ['🧀 Творог', 169, 16.7, 9, 2],
  'йогурт': ['🥛 Йогурт', 60, 3.5, 1.5, 8.5],
  'молоко': ['🥛 Молоко', 64, 3.2, 3.6, 4.7],
  'кефир': ['🥛 Кефир', 56, 2.8, 3.2, 4],
  'сыр': ['🧀 Сыр', 360, 26, 27, 0],
  'яйцо': ['🥚 Яйцо', 157, 12.7, 11.5, 0.7],
  'яйца': ['🥚 Яйца', 157, 12.7, 11.5, 0.7],
  'омлет': ['🍳 Омлет', 154, 9.6, 11.6, 1.9],
  'яичница': ['🍳 Яичница', 196, 13.6, 15.4, 0.9],
  'банан': ['🍌 Банан', 96, 1.5, 0.5, 21],
  'яблоко': ['🍎 Яблоко', 52, 0.4, 0.4, 11.4],
  'апельсин': ['🍊 Апельсин', 43, 0.9, 0.2, 8.1],
  'груша': ['🍐 Груша', 57, 0.4, 0.3, 10.9],
  'хлеб': ['🍞 Хлеб', 265, 7.6, 3.3, 50.1],
  'батон': ['🥖 Батон', 260, 7.7, 2.9, 52.5],
  'борщ': ['🍲 Борщ', 60, 3, 2, 8],
  'суп': ['🍜 Суп', 50, 2.5, 1.5, 7],
  'щи': ['🍲 Щи', 35, 2, 1.2, 4.5],
  'пицца': ['🍕 Пицца', 266, 11, 10, 33],
  'бургер': ['🍔 Бургер', 295, 17, 14, 24],
  'плов': ['🍛 Плов', 150, 4.8, 6.7, 18]
};

/** Ищем продукт в локальной базе и считаем КБЖУ на указанную порцию. */
function fromLocalDb(text, grams = 100) {
  const lower = String(text).toLowerCase();
  let best = null;
  let bestKeyLength = 0;

  for (const [key, value] of Object.entries(FOOD_DB)) {
    if (lower.includes(key) && key.length > bestKeyLength) {
      best = value;
      bestKeyLength = key.length;
    }
  }

  if (!best) return null;

  const [name, kcal, protein, fats, carbs] = best;
  const k = grams / 100;
  return {
    food_name: `${name} (${grams} г)`,
    calories: Math.round(kcal * k),
    protein: Math.round(protein * k * 10) / 10,
    fats: Math.round(fats * k * 10) / 10,
    carbs: Math.round(carbs * k * 10) / 10
  };
}

/** Вытаскиваем граммовку из текста. */
function parseWeight(text) {
  const lower = String(text).toLowerCase();
  const explicit = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм|g)\b/);
  if (explicit) {
    const grams = parseFloat(explicit[1].replace(',', '.'));
    if (grams >= 5 && grams <= 3000) return Math.round(grams);
  }
  if (/больш(ая|ой|ую|ий)/.test(lower)) return 200;
  if (/маленьк(ая|ой|ую|ий)|немного|чуть/.test(lower)) return 80;
  const pieces = lower.match(/(\d+)\s*(?:шт|штук)/);
  if (pieces) return Math.round(parseInt(pieces[1], 10) * 100);
  return 100;
}

/* ------------------------------------------------------------------ */
/* 1. Анализ еды по фото                                               */
/* ------------------------------------------------------------------ */

export async function analyzeFoodImage(buffer, mimeType = 'image/jpeg') {
  const base64 = bufferToBase64(buffer);

  const prompt = `Ты нутрициолог с 10-летним опытом. Проанализируй еду на фото.
Оцени состав блюда и размер порции по изображению.
ВАЖНО: название блюда пиши ТОЛЬКО по-русски, с эмодзи и примерной граммовкой, без английских слов.
Ответь ТОЛЬКО валидным JSON без пояснений:
{"food_name":"название по-русски с эмодзи и граммовкой","calories":число,"protein":число,"fats":число,"carbs":число}
Если на фото нет еды — верни {"error":"no_food"}.`;

  const text = await gemini([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } }
  ], { temperature: 0.2, maxTokens: 512 });

  if (text) {
    const parsed = extractJson(text);
    if (parsed?.error === 'no_food') return { error: 'no_food' };
    const food = normalizeFood(parsed);
    if (food) return food;
  }

  return {
    error: hasGemini() ? 'failed' : 'no_vision_provider'
  };
}

/* ------------------------------------------------------------------ */
/* 2. Голос → текст                                                    */
/* ------------------------------------------------------------------ */

export async function transcribeVoice(buffer, mimeType = 'audio/ogg') {
  const base64 = bufferToBase64(buffer);

  const text = await gemini([
    { text: 'Распознай речь из этого голосового сообщения и верни ТОЛЬКО текст сказанного, без пояснений и кавычек.' },
    { inlineData: { mimeType, data: base64 } }
  ], { temperature: 0.1, maxTokens: 300 });

  if (!text) return null;
  return text.replace(/^["'«]|["'»]$/g, '').trim() || null;
}

/* ------------------------------------------------------------------ */
/* 3. Определение блюда по тексту                                      */
/* ------------------------------------------------------------------ */

export async function extractFoodFromText(text) {
  const grams = parseWeight(text);

  const prompt = `Ты нутрициолог. Пользователь описал, что съел: "${text}"
Оцени КБЖУ этой еды. Если в тексте указана граммовка или размер порции — учитывай её, иначе бери обычную порцию (${grams} г).
ВАЖНО: название блюда пиши ТОЛЬКО по-русски, с эмодзи и граммовкой, без английских слов.
Ответь ТОЛЬКО валидным JSON:
{"food_name":"название по-русски с эмодзи и граммовкой","calories":число,"protein":число,"fats":число,"carbs":число}`;

  const aiText = await gemini([{ text: prompt }], { temperature: 0.2, maxTokens: 400 });
  if (aiText) {
    const food = normalizeFood(extractJson(aiText));
    if (food) return food;
  }

  const fallbackText = await pollinations([
    { role: 'system', content: 'Ты нутрициолог. Отвечай ТОЛЬКО валидным JSON без пояснений.' },
    { role: 'user', content: prompt }
  ]);
  if (fallbackText) {
    const food = normalizeFood(extractJson(fallbackText));
    if (food) return food;
  }

  // Последний рубеж — локальная база
  const local = fromLocalDb(text, grams);
  if (local) return local;

  return {
    food_name: `🍽️ ${String(text).slice(0, 40)}`,
    calories: 350,
    protein: 18,
    fats: 12,
    carbs: 40
  };
}

/* ------------------------------------------------------------------ */
/* 4. Консультация                                                     */
/* ------------------------------------------------------------------ */

function profileLine(profile) {
  if (!profile) return 'Профиль не заполнен.';
  return `Рост: ${profile.height} см, вес: ${profile.weight} кг, цель: ${profile.goal_weight} кг, возраст: ${profile.age}, пол: ${profile.gender === 'male' ? 'мужской' : 'женский'}, норма: ${profile.daily_calories} ккал, Б ${profile.daily_protein} г, Ж ${profile.daily_fats} г, У ${profile.daily_carbs} г.`;
}

function statsLine(stats) {
  if (!stats) return 'Сегодня ещё ничего не записано.';
  return `Съедено: ${stats.calories.toFixed(0)}/${stats.dailyCalories} ккал, Б ${stats.protein.toFixed(1)}/${stats.dailyProtein} г, Ж ${stats.fats.toFixed(1)}/${stats.dailyFats} г, У ${stats.carbs.toFixed(1)}/${stats.dailyCarbs} г.`;
}

export async function getConsultation({ question, profile, todayStats }) {
  const prompt = `Ты опытный диетолог, нутрициолог и фитнес-тренер с 10-летним стажем. Отвечай по-русски, дружелюбно, с эмодзи.
Учитывай КБЖУ, витамины и микроэлементы, а также цель пользователя.

Профиль: ${profileLine(profile)}
Сегодня: ${statsLine(todayStats)}

Вопрос пользователя: "${question}"

Ответь ТОЛЬКО валидным JSON:
{"short":"краткий ответ на 1-2 предложения","detailed":"развёрнутый ответ: подробные рекомендации, примеры блюд, витамины, на что обратить внимание"}`;

  const aiText = await gemini([{ text: prompt }], { temperature: 0.7, maxTokens: 1200 });
  const parsed = extractJson(aiText || '');
  if (parsed?.short) {
    return {
      short: String(parsed.short),
      detailed: String(parsed.detailed || parsed.short)
    };
  }

  const fallbackText = await pollinations([
    { role: 'system', content: 'Ты диетолог. Отвечай ТОЛЬКО валидным JSON: {"short":"...","detailed":"..."}' },
    { role: 'user', content: prompt }
  ]);
  const parsedFallback = extractJson(fallbackText || '');
  if (parsedFallback?.short) {
    return {
      short: String(parsedFallback.short),
      detailed: String(parsedFallback.detailed || parsedFallback.short)
    };
  }

  return ruleBasedAdvice(question, todayStats);
}

/** Рекомендации без нейросети (работают всегда). */
function ruleBasedAdvice(question, stats) {
  const q = String(question || '').toLowerCase();

  if (/завтрак|утро/.test(q)) {
    return {
      short: '🌅 На завтрак — сложные углеводы + белок: овсянка с яйцами или творог с фруктами.',
      detailed: 'Идеальный завтрак: сложные углеводы (овсянка, гречка), белок (яйца, творог) и клетчатка (фрукты, овощи).\n\nПримеры:\n• Овсянка с бананом и орехами — 350 ккал\n• Омлет с овощами и цельнозерновым хлебом — 400 ккал\n• Творог с ягодами и мёдом — 300 ккал\n\nНе пропускай завтрак: он стабилизирует сахар в крови и снижает переедание вечером.'
    };
  }
  if (/белок|протеин/.test(q)) {
    return {
      short: '🥩 Больше белка: курица, рыба, яйца, творог, бобовые — 1.5–2 г на кг веса.',
      detailed: 'Лучшие источники белка (на 100 г):\n• Куриная грудка — 31 г\n• Тунец — 23 г\n• Индейка — 21.6 г\n• Рыба — 20 г\n• Творог — 16.7 г\n• Яйца — 12.7 г\n• Бобовые — 9 г\n\nНорма: 1.5–2 г белка на кг массы тела. Разноси по 4–5 приёмам пищи по 25–35 г — так он усваивается лучше.'
    };
  }
  if (/похуд|сброс|скинуть|дефицит/.test(q)) {
    return {
      short: '📉 Дефицит 15–20%, больше белка и овощей, меньше быстрых углеводов.',
      detailed: 'Правила снижения веса:\n1. Дефицит 300–500 ккал/день\n2. Белок 30% калорий — сохраняет мышцы\n3. Овощи 400+ г в день — сытость и клетчатка\n4. Сложные углеводы вместо быстрых\n5. Вода 1.5–2 л\n6. Силовые + кардио 3–4 раза в неделю\n7. Сон 7–8 часов\n\nРезкий дефицит (>25%) ведёт к потере мышц и срывам.'
    };
  }
  if (/витамин/.test(q)) {
    return {
      short: '💊 Ключевые: D, B12, железо, омега-3, магний — проверяй по анализам.',
      detailed: 'Частые дефициты и источники:\n• Витамин D — рыба, яйца, солнце\n• B12 — мясо, рыба, яйца (критичен для вегетарианцев)\n• Железо — красное мясо, печень + витамин C для усвоения\n• Омега-3 — жирная рыба 2 раза в неделю\n• Магний — орехи, зелень, какао\n• Кальций — молочка, кунжут, зелень\n\nЛучше сдавать анализы и корректировать по факту, а не пить всё подряд.'
    };
  }

  if (stats) {
    const remaining = stats.dailyCalories - stats.calories;
    const proteinLeft = stats.dailyProtein - stats.protein;

    if (remaining > 500) {
      return {
        short: `💡 Осталось ${remaining.toFixed(0)} ккал — добавь белок и сложные углеводы.`,
        detailed: `До нормы осталось ${remaining.toFixed(0)} ккал (белка не хватает ${Math.max(0, proteinLeft).toFixed(0)} г).\n\nПодойдёт:\n• Курица с гречкой и овощами — 450 ккал\n• Рыба с овощами — 350 ккал\n• Творог с фруктами — 250 ккал\n\nСледи за балансом БЖУ и не оставляй весь объём на вечер.`
      };
    }
    if (remaining > 0) {
      return {
        short: `💡 Осталось ${remaining.toFixed(0)} ккал — лёгкий ужин или перекус.`,
        detailed: `До нормы осталось ${remaining.toFixed(0)} ккал.\n\nВарианты:\n• Овощной салат с куриной грудкой — 300 ккал\n• Творог с ягодами — 200 ккал\n• Омлет с овощами — 250 ккал\n• Фрукт + йогурт — 180 ккал\n\nУжин лучше за 2–3 часа до сна.`
      };
    }
    return {
      short: '⚠️ Норма превышена. Завтра вернись к плану и добавь активности.',
      detailed: `Превышение на ${Math.abs(remaining).toFixed(0)} ккал — не критично.\n\nЗавтра:\n• Лёгкий завтрак с белком\n• Больше овощей и воды\n• Меньше быстрых углеводов\n• Прогулка 30–40 минут\n\nОдин день ничего не решает — важна регулярность.`
    };
  }

  return {
    short: '💡 Соблюдай баланс КБЖУ, ешь 4–5 раз в день и пей достаточно воды.',
    detailed: 'Основы здорового питания:\n1. Регулярность — 4–5 приёмов пищи\n2. Баланс — Б 30% / Ж 30% / У 40%\n3. Вода — 1.5–2 л в день\n4. Овощи — минимум 400 г\n5. Белок в каждом приёме — 25–35 г\n6. Сложные углеводы, минимум быстрых\n7. Домашняя еда вместо фастфуда'
  };
}

/* ------------------------------------------------------------------ */
/* 5. Рекомендация после добавления еды (1-2 предложения)              */
/* ------------------------------------------------------------------ */

export function shortRecommendation(stats, mealTime) {
  if (!stats) return null;
  const remaining = stats.dailyCalories - stats.calories;
  const proteinLeft = stats.dailyProtein - stats.protein;
  const carbsLeft = stats.dailyCarbs - stats.carbs;

  if (remaining <= 0) {
    return `⚠️ Дневная норма превышена на ${Math.abs(remaining).toFixed(0)} ккал — завтра добавь активности и вернись к плану 🚶`;
  }

  const parts = [];
  if (proteinLeft > 25) parts.push(`белка не хватает ${proteinLeft.toFixed(0)} г — добавь курицу, рыбу или творог 🥩`);
  if (carbsLeft > 60 && mealTime !== 'dinner') parts.push('можно сложные углеводы: гречка, овсянка 🌾');
  if (remaining < 300) parts.push('остаток небольшой — хватит лёгкого перекуса 🍎');

  if (!parts.length) {
    return `💡 Осталось ${remaining.toFixed(0)} ккал — баланс хороший, продолжай так же 👍`;
  }
  return `💡 Осталось ${remaining.toFixed(0)} ккал. ${parts.join(', ')}.`;
}

/* ------------------------------------------------------------------ */
/* 6. Анализ медицинских анализов (скриншот)                           */
/* ------------------------------------------------------------------ */

export async function analyzeHealthTests(buffer, mimeType, previous = []) {
  if (!hasGemini()) return null;

  const base64 = bufferToBase64(buffer);
  const prevText = previous.length
    ? `Предыдущие показатели для сравнения:\n${JSON.stringify(previous)}`
    : 'Это первый анализ пользователя.';

  const prompt = `Ты врач-диетолог. Проанализируй медицинские анализы на изображении.
${prevText}

Ответь ТОЛЬКО валидным JSON:
{"analysis":"какие показатели видны и их значения","recommendations":"рекомендации по питанию с учётом показателей","comparison":"динамика по сравнению с предыдущими анализами или 'первый анализ'"}`;

  const text = await gemini([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } }
  ], { temperature: 0.4, maxTokens: 1500 });

  const parsed = extractJson(text || '');
  if (!parsed) return null;

  return {
    analysis: String(parsed.analysis || ''),
    recommendations: String(parsed.recommendations || ''),
    comparison: String(parsed.comparison || '')
  };
}

export default {
  analyzeFoodImage,
  transcribeVoice,
  extractFoodFromText,
  getConsultation,
  shortRecommendation,
  analyzeHealthTests,
  hasGemini,
  aiStatus
};