import { getDB, saveDB } from '../database/db.js';

export async function addDiaryEntry(entry) {
  const db = await getDB();
  
  db.run(`
    INSERT INTO food_diary 
    (user_id, date, meal_time, food_name, calories, protein, fats, carbs, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    entry.user_id,
    entry.date,
    entry.meal_time,
    entry.food_name,
    entry.calories,
    entry.protein,
    entry.fats,
    entry.carbs,
    entry.photo_url || null
  ]);
  
  saveDB();
}

export async function getDailyDiary(userId, date) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT * FROM food_diary 
    WHERE user_id = ? AND date = ?
    ORDER BY 
      CASE meal_time
        WHEN 'breakfast' THEN 1
        WHEN 'lunch' THEN 2
        WHEN 'snack' THEN 3
        WHEN 'dinner' THEN 4
      END,
      created_at
  `, [userId, date]);
  
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

export async function getDiaryForPeriod(userId, startDate, endDate) {
  const db = await getDB();
  
  const result = db.exec(`
    SELECT * FROM food_diary 
    WHERE user_id = ? AND date BETWEEN ? AND ?
    ORDER BY date, created_at
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

export async function deleteDiaryEntry(entryId) {
  const db = await getDB();
  
  db.run('DELETE FROM food_diary WHERE id = ?', [entryId]);
  saveDB();
}

export async function updateDiaryEntry(entryId, updates) {
  const db = await getDB();
  
  const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  
  db.run(`
    UPDATE food_diary 
    SET ${fields}
    WHERE id = ?
  `, [...values, entryId]);
  
  saveDB();
}
