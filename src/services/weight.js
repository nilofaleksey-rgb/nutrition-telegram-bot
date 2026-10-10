import { getDB, saveDB } from '../database/db.js';
import { updateUserWeight } from './user.js';

export async function addWeightLog(log) {
  const db = await getDB();
  
  db.run(`
    INSERT INTO weight_logs (user_id, weight, date)
    VALUES (?, ?, ?)
  `, [log.user_id, log.weight, log.date]);
  
  saveDB();
  
  // Обновляем текущий вес в профиле пользователя
  await updateUserWeight(log.user_id, log.weight);
}

export async function getWeightHistory(userId, limit = 30) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT * FROM weight_logs
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT ?
  `, [userId, limit]);
  
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

export async function getWeightForPeriod(userId, startDate, endDate) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT * FROM weight_logs
    WHERE user_id = ? AND date BETWEEN ? AND ?
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

export async function getLatestWeight(userId) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT * FROM weight_logs
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1
  `, [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  
  const obj = {};
  columns.forEach((col, idx) => {
    obj[col] = values[idx];
  });
  
  return obj;
}
