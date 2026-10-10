import { getDB, saveDB } from '../database/db.js';

export async function createUser(userData) {
  const db = await getDB();
  
  db.run(`
    INSERT OR REPLACE INTO users 
    (user_id, username, first_name, height, weight, gender, age, goal_weight, 
     daily_calories, daily_protein, daily_fats, daily_carbs, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    userData.user_id,
    userData.username,
    userData.first_name,
    userData.height,
    userData.weight,
    userData.gender,
    userData.age,
    userData.goal_weight,
    userData.daily_calories,
    userData.daily_protein,
    userData.daily_fats,
    userData.daily_carbs
  ]);
  
  saveDB();
}

export async function getUserProfile(userId) {
  const db = await getDB();
  
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  
  const profile = {};
  columns.forEach((col, idx) => {
    profile[col] = values[idx];
  });
  
  return profile;
}

export async function updateUser(userId, updates) {
  const db = await getDB();
  
  const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  
  db.run(`
    UPDATE users 
    SET ${fields}, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `, [...values, userId]);
  
  saveDB();
}

export async function updateUserWeight(userId, weight) {
  const db = await getDB();
  
  db.run(`
    UPDATE users 
    SET weight = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `, [weight, userId]);
  
  saveDB();
}
