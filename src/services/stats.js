import { getDB } from '../database/db.js';
import { getUserProfile } from './user.js';

export async function getDailyStats(userId, date) {
  const db = await getDB();
  
  // Получаем сумму за день
  const result = db.exec(`
    SELECT 
      SUM(calories) as calories,
      SUM(protein) as protein,
      SUM(fats) as fats,
      SUM(carbs) as carbs
    FROM food_diary
    WHERE user_id = ? AND date = ?
  `, [userId, date]);
  
  if (result.length === 0 || !result[0].values[0][0]) {
    return null;
  }
  
  const [calories, protein, fats, carbs] = result[0].values[0];
  
  // Получаем дневную норму пользователя
  const profile = await getUserProfile(userId);
  
  return {
    calories: calories || 0,
    protein: protein || 0,
    fats: fats || 0,
    carbs: carbs || 0,
    dailyCalories: profile?.daily_calories || 2000,
    dailyProtein: profile?.daily_protein || 100,
    dailyFats: profile?.daily_fats || 60,
    dailyCarbs: profile?.daily_carbs || 250
  };
}

export async function getPeriodStats(userId, startDate, endDate) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT 
      date,
      SUM(calories) as calories,
      SUM(protein) as protein,
      SUM(fats) as fats,
      SUM(carbs) as carbs
    FROM food_diary
    WHERE user_id = ? AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `, [userId, startDate, endDate]);
  
  if (result.length === 0) {
    return [];
  }
  
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
}

export async function getAverageStats(userId, days = 7) {
  const db = await getDB();
  
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const result = db.exec(`
    SELECT 
      AVG(daily_calories) as avg_calories,
      AVG(daily_protein) as avg_protein,
      AVG(daily_fats) as avg_fats,
      AVG(daily_carbs) as avg_carbs
    FROM (
      SELECT 
        date,
        SUM(calories) as daily_calories,
        SUM(protein) as daily_protein,
        SUM(fats) as daily_fats,
        SUM(carbs) as daily_carbs
      FROM food_diary
      WHERE user_id = ? AND date BETWEEN ? AND ?
      GROUP BY date
    )
  `, [userId, startDate, endDate]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  
  const [avg_calories, avg_protein, avg_fats, avg_carbs] = result[0].values[0];
  
  return {
    avg_calories,
    avg_protein,
    avg_fats,
    avg_carbs
  };
}
