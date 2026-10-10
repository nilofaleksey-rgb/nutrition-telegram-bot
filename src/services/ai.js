import axios from 'axios';

// Простая база данных продуктов с КБЖУ на 100г
const foodDatabase = {
  // Каши и крупы
  'гречка': { name: '🌾 Гречка', calories: 330, protein: 12.6, fats: 3.3, carbs: 62.1 },
  'гречневая каша': { name: '🌾 Гречневая каша', calories: 90, protein: 3.2, fats: 0.8, carbs: 17.1 },
  'рис': { name: '🍚 Рис', calories: 344, protein: 6.7, fats: 0.7, carbs: 78.9 },
  'рисовая каша': { name: '🍚 Рисовая каша', calories: 78, protein: 1.5, fats: 0.1, carbs: 17.3 },
  'овсянка': { name: '🥣 Овсянка', calories: 342, protein: 12.3, fats: 6.1, carbs: 59.5 },
  'овсяная каша': { name: '🥣 Овсяная каша', calories: 88, protein: 3.2, fats: 1.7, carbs: 14.2 },
  'перловка': { name: '🌾 Перловка', calories: 320, protein: 9.3, fats: 1.1, carbs: 66.9 },
  
  // Мясо и птица
  'курица': { name: '🍗 Куриная грудка', calories: 165, protein: 31, fats: 3.6, carbs: 0 },
  'куриная грудка': { name: '🍗 Куриная грудка', calories: 165, protein: 31, fats: 3.6, carbs: 0 },
  'куриное филе': { name: '🍗 Куриное филе', calories: 165, protein: 31, fats: 3.6, carbs: 0 },
  'говядина': { name: '🥩 Говядина', calories: 250, protein: 26, fats: 15, carbs: 0 },
  'свинина': { name: '🥓 Свинина', calories: 242, protein: 16, fats: 21, carbs: 0 },
  'индейка': { name: '🦃 Индейка', calories: 189, protein: 21.6, fats: 12, carbs: 0 },
  'котлета': { name: '🍖 Котлета', calories: 260, protein: 18, fats: 20, carbs: 4 },
  'тефтели': { name: '🍖 Тефтели', calories: 217, protein: 17, fats: 12, carbs: 9 },
  
  // Рыба
  'рыба': { name: '🐟 Рыба', calories: 120, protein: 20, fats: 5, carbs: 0 },
  'лосось': { name: '🐟 Лосось', calories: 208, protein: 20, fats: 13, carbs: 0 },
  'тунец': { name: '🐟 Тунец', calories: 96, protein: 23, fats: 0.6, carbs: 0 },
  'минтай': { name: '🐟 Минтай', calories: 72, protein: 16, fats: 1, carbs: 0 },
  
  // Овощи
  'салат': { name: '🥗 Овощной салат', calories: 50, protein: 2, fats: 1, carbs: 8 },
  'огурец': { name: '🥒 Огурец', calories: 15, protein: 0.8, fats: 0.1, carbs: 2.8 },
  'помидор': { name: '🍅 Помидор', calories: 20, protein: 0.9, fats: 0.2, carbs: 4.2 },
  'картофель': { name: '🥔 Картофель', calories: 77, protein: 2, fats: 0.4, carbs: 16.3 },
  'картошка': { name: '🥔 Картошка', calories: 77, protein: 2, fats: 0.4, carbs: 16.3 },
  'капуста': { name: '🥬 Капуста', calories: 27, protein: 1.8, fats: 0.1, carbs: 4.7 },
  'морковь': { name: '🥕 Морковь', calories: 41, protein: 1.3, fats: 0.1, carbs: 9.6 },
  'брокколи': { name: '🥦 Брокколи', calories: 34, protein: 2.8, fats: 0.4, carbs: 6.6 },
  
  // Молочные продукты
  'творог': { name: '🧀 Творог', calories: 169, protein: 16.7, fats: 9, carbs: 2 },
  'йогурт': { name: '🥛 Йогурт', calories: 60, protein: 3.5, fats: 1.5, carbs: 8.5 },
  'молоко': { name: '🥛 Молоко', calories: 64, protein: 3.2, fats: 3.6, carbs: 4.7 },
  'кефир': { name: '🥛 Кефир', calories: 56, protein: 2.8, fats: 3.2, carbs: 4 },
  'сыр': { name: '🧀 Сыр', calories: 360, protein: 26, fats: 27, carbs: 0 },
  
  // Яйца
  'яйцо': { name: '🥚 Яйцо', calories: 157, protein: 12.7, fats: 11.5, carbs: 0.7 },
  'яйца': { name: '🥚 Яйца', calories: 157, protein: 12.7, fats: 11.5, carbs: 0.7 },
  'омлет': { name: '🍳 Омлет', calories: 154, protein: 9.6, fats: 11.6, carbs: 1.9 },
  'яичница': { name: '🍳 Яичница', calories: 196, protein: 13.6, fats: 15.4, carbs: 0.9 },
  
  // Фрукты
  'банан': { name: '🍌 Банан', calories: 96, protein: 1.5, fats: 0.5, carbs: 21 },
  'яблоко': { name: '🍎 Яблоко', calories: 52, protein: 0.4, fats: 0.4, carbs: 11.4 },
  'апельсин': { name: '🍊 Апельсин', calories: 43, protein: 0.9, fats: 0.2, carbs: 8.1 },
  'груша': { name: '🍐 Груша', calories: 57, protein: 0.4, fats: 0.3, carbs: 10.9 },
  
  // Хлеб и выпечка
  'хлеб': { name: '🍞 Хлеб', calories: 265, protein: 7.6, fats: 3.3, carbs: 50.1 },
  'батон': { name: '🥖 Батон', calories: 260, protein: 7.7, fats: 2.9, carbs: 52.5 },
  
  // Готовые блюда
  'борщ': { name: '🍲 Борщ', calories: 60, protein: 3, fats: 2, carbs: 8 },
  'суп': { name: '🍜 Суп', calories: 50, protein: 2.5, fats: 1.5, carbs: 7 },
  'щи': { name: '🍲 Щи', calories: 35, protein: 2, fats: 1.2, carbs: 4.5 },
  'пицца': { name: '🍕 Пицца', calories: 266, protein: 11, fats: 10, carbs: 33 },
  'бургер': { name: '🍔 Бургер', calories: 295, protein: 17, fats: 14, carbs: 24 },
  'паста': { name: '🍝 Паста', calories: 158, protein: 5.8, fats: 0.9, carbs: 30.9 },
  'макароны': { name: '🍝 Макароны', calories: 158, protein: 5.8, fats: 0.9, carbs: 30.9 },
  'плов': { name: '🍛 Плов', calories: 150, protein: 4.8, fats: 6.7, carbs: 18 },
};

// Анализ еды по фото (упрощенная версия без AI)
export async function analyzeFood(photoUrl) {
  try {
    // Без AI просто возвращаем среднее блюдо
    return {
      food_name: '🍽️ Блюдо',
      calories: 350,
      protein: 18,
      fats: 12,
      carbs: 40
    };
  } catch (error) {
    console.error('Ошибка анализа фото:', error);
    return {
      food_name: '🍽️ Блюдо',
      calories: 350,
      protein: 18,
      fats: 12,
      carbs: 40
    };
  }
}

// Транскрибация голосового сообщения
export async function transcribeVoice(voiceUrl) {
  try {
    // Без AI возвращаем null
    return null;
  } catch (error) {
    console.error('Ошибка транскрибации:', error);
    return null;
  }
}

// Извлечение данных о еде из текста
export async function extractFoodFromText(text) {
  try {
    const textLower = text.toLowerCase().trim();
    
    // Определяем порцию
    let portionMultiplier = 1;
    let portionGrams = 100;
    
    // Ищем указания на вес
    const weightMatch = textLower.match(/(\d+)\s*(г|гр|грамм|gram)/i);
    if (weightMatch) {
      portionGrams = parseInt(weightMatch[1]);
      portionMultiplier = portionGrams / 100;
    }
    
    // Ищем указания на размер порции
    if (textLower.includes('большая') || textLower.includes('большой')) {
      portionMultiplier = 1.5;
      portionGrams = 150;
    } else if (textLower.includes('маленькая') || textLower.includes('маленький') || textLower.includes('немного')) {
      portionMultiplier = 0.7;
      portionGrams = 70;
    } else if (textLower.includes('средняя') || textLower.includes('средний')) {
      portionMultiplier = 1;
      portionGrams = 100;
    }
    
    // Ищем продукт в базе
    let foundFood = null;
    for (const [key, food] of Object.entries(foodDatabase)) {
      if (textLower.includes(key)) {
        foundFood = food;
        break;
      }
    }
    
    // Если ничего не нашли, возвращаем усредненные значения
    if (!foundFood) {
      return {
        food_name: '🍽️ ' + text.substring(0, 30),
        calories: Math.round(350 * portionMultiplier),
        protein: Math.round(18 * portionMultiplier * 10) / 10,
        fats: Math.round(12 * portionMultiplier * 10) / 10,
        carbs: Math.round(40 * portionMultiplier * 10) / 10
      };
    }
    
    // Рассчитываем КБЖУ
    return {
      food_name: foundFood.name + ` (${portionGrams}г)`,
      calories: Math.round(foundFood.calories * portionMultiplier),
      protein: Math.round(foundFood.protein * portionMultiplier * 10) / 10,
      fats: Math.round(foundFood.fats * portionMultiplier * 10) / 10,
      carbs: Math.round(foundFood.carbs * portionMultiplier * 10) / 10
    };
  } catch (error) {
    console.error('Ошибка извлечения еды из текста:', error);
    return null;
  }
}

// Консультация с AI диетологом (на основе правил)
export async function getConsultation(context) {
  try {
    const advice = generateAdvice(context);
    return advice;
  } catch (error) {
    console.error('Ошибка консультации:', error);
    return {
      short: '💡 Соблюдай баланс КБЖУ и пей достаточно воды',
      detailed: 'Общие рекомендации:\n- Ешь 4-5 раз в день небольшими порциями\n- Пей 1.5-2 литра воды\n- Следи за балансом белков (30%), жиров (30%) и углеводов (40%)\n- Избегай быстрых углеводов вечером\n- Добавь больше овощей и фруктов'
    };
  }
}

// Генерация советов на основе правил
function generateAdvice(context) {
  const { question, profile, todayStats } = context;
  
  const questionLower = question ? question.toLowerCase() : '';
  
  // Если вопрос про завтрак
  if (questionLower.includes('завтрак') || questionLower.includes('утро')) {
    return {
      short: '🌅 На завтрак лучше всего: овсянка, яйца, творог с фруктами',
      detailed: 'Идеальный завтрак:\n- Сложные углеводы (овсянка, гречка)\n- Белок (яйца, творог)\n- Клетчатка (фрукты, овощи)\n\nПримеры:\n• Овсянка с бананом и орехами\n• Омлет с овощами и хлебом\n• Творог с ягодами и медом'
    };
  }
  
  // Если вопрос про белок
  if (questionLower.includes('белок') || questionLower.includes('протеин')) {
    return {
      short: '🥩 Больше белка: курица, рыба, яйца, творог, бобовые',
      detailed: 'Лучшие источники белка:\n- Куриная грудка (31г белка на 100г)\n- Творог (17г белка на 100г)\n- Яйца (13г белка на 100г)\n- Рыба (20г белка на 100г)\n- Бобовые (9г белка на 100г)\n\nРекомендую 1.5-2г белка на кг веса'
    };
  }
  
  // Если вопрос про похудение
  if (questionLower.includes('похуд') || questionLower.includes('сброс') || questionLower.includes('скинуть')) {
    return {
      short: '📉 Для похудения: дефицит калорий 15-20%, больше белка, меньше быстрых углеводов',
      detailed: 'Правила похудения:\n1. Дефицит калорий 300-500 ккал в день\n2. Больше белка (30% калорий)\n3. Меньше быстрых углеводов\n4. Регулярное питание 4-5 раз\n5. Минимум 1.5л воды в день\n6. Физическая активность 3-4 раза в неделю'
    };
  }
  
  // Если есть статистика за день
  if (todayStats) {
    const { calories, protein, fats, carbs, dailyCalories, dailyProtein } = todayStats;
    const remaining = dailyCalories - calories;
    
    if (remaining > 500) {
      return {
        short: `💡 Осталось ${remaining.toFixed(0)} ккал. Добавь белок и сложные углеводы`,
        detailed: `До конца дня осталось ${remaining.toFixed(0)} ккал.\n\nРекомендую:\n- Куриная грудка с гречкой (450 ккал)\n- Рыба с овощами (350 ккал)\n- Творог с фруктами (250 ккал)\n\nСледи за балансом БЖУ!`
      };
    } else if (remaining > 0 && remaining <= 500) {
      return {
        short: `💡 Осталось ${remaining.toFixed(0)} ккал. Легкий ужин или перекус`,
        detailed: `До нормы осталось ${remaining.toFixed(0)} ккал.\n\nПодойдет:\n- Овощной салат с куриной грудкой\n- Творог с ягодами\n- Омлет с овощами\n- Фрукты и йогурт`
      };
    } else {
      return {
        short: '⚠️ Дневная норма превышена. Завтра соблюдай баланс',
        detailed: 'Превышение калорий сегодня.\n\nЗавтра:\n- Начни с легкого завтрака\n- Больше овощей\n- Меньше порции\n- Пей больше воды\n- Избегай сладкого\n\nОдин день не критичен, главное вернуться к плану!'
      };
    }
  }
  
  // Дефолтный совет
  return {
    short: '💡 Соблюдай баланс КБЖУ, ешь регулярно, пей достаточно воды',
    detailed: 'Основные правила здорового питания:\n\n1. Регулярность - ешь 4-5 раз в день\n2. Баланс - 30% белки, 30% жиры, 40% углеводы\n3. Вода - минимум 1.5-2 литра в день\n4. Овощи - минимум 400г в день\n5. Избегай быстрых углеводов вечером\n6. Планируй меню заранее\n7. Не пропускай завтрак'
  };
}

// Анализ медицинских анализов
export async function analyzeHealthTests(imageUrl, previousAnalyses = []) {
  return {
    analysis: 'Для точного анализа медицинских показателей рекомендую проконсультироваться с врачом',
    recommendations: 'Общие рекомендации: сбалансированное питание, достаточное количество воды, больше овощей и фруктов',
    comparison: previousAnalyses.length > 0 ? 'Сравнение доступно после консультации с врачом' : ''
  };
}
