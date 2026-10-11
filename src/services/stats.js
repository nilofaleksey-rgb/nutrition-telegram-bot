import { getDB } from '../database/db.js';
import { getUserProfile } from './user.js';

function rowsToObjects(result) {
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => Object.fromEntries(columns.map((col, idx) => [col, row[idx]])));
}

export async function getDailyStats(userId, date) {
  const db = await getDB();
  const result = db.exec(`SELECT SUM(calories) as calories, SUM(protein) as protein, SUM(fats) as fats, SUM(carbs) as carbs FROM food_diary WHERE user_id = ? AND date = ?`, [userId, date]);
  const totals = result.length ? result[0].values[0] : [0, 0, 0, 0];
  const profile = await getUserProfile(userId);
  if (!profile && !totals?.[0]) return null;
  return {
    calories: totals?.[0] || 0,
    protein: totals?.[1] || 0,
    fats: totals?.[2] || 0,
    carbs: totals?.[3] || 0,
    dailyCalories: profile?.daily_calories || 2000,
    dailyProtein: profile?.daily_protein || 100,
    dailyFats: profile?.daily_fats || 60,
    dailyCarbs: profile?.daily_carbs || 250
  };
}

export async function getPeriodStats(userId, startDate, endDate) {
  const db = await getDB();
  const result = db.exec(`SELECT date, SUM(calories) as calories, SUM(protein) as protein, SUM(fats) as fats, SUM(carbs) as carbs FROM food_diary WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, [userId, startDate, endDate]);
  return rowsToObjects(result);
}

export async function getAverageStats(userId, days = 7) {
  const db = await getDB();
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const result = db.exec(`SELECT AVG(daily_calories) as avg_calories, AVG(daily_protein) as avg_protein, AVG(daily_fats) as avg_fats, AVG(daily_carbs) as avg_carbs FROM (SELECT date, SUM(calories) as daily_calories, SUM(protein) as daily_protein, SUM(fats) as daily_fats, SUM(carbs) as daily_carbs FROM food_diary WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date)`, [userId, startDate, endDate]);
  const values = result.length ? result[0].values[0] : [null, null, null, null];
  if (!values || values.every(v => v === null)) return null;
  return { avg_calories: values[0], avg_protein: values[1], avg_fats: values[2], avg_carbs: values[3] };
}
