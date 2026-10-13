import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '../../data/nutrition.db');
const DB_DIR = dirname(DB_PATH);

// Создаем папку data если её нет
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

let db = null;
let SQL = null;

export async function getDB() {
  if (!db) {
    if (!SQL) {
      SQL = await initSqlJs();
    }
    
    // Загружаем существующую БД или создаем новую
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  }
  return db;
}

export function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  }
}

export async function setupDatabase() {
  const database = await getDB();

  // Таблица пользователей
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      height INTEGER,
      weight REAL,
      gender TEXT,
      age INTEGER,
      goal_weight REAL,
      daily_calories INTEGER,
      daily_protein REAL,
      daily_fats REAL,
      daily_carbs REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица дневника питания
  database.run(`
    CREATE TABLE IF NOT EXISTS food_diary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      meal_time TEXT NOT NULL,
      food_name TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      fats REAL NOT NULL,
      carbs REAL NOT NULL,
      photo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // Таблица замеров веса
  database.run(`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      weight REAL NOT NULL,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // Таблица анализов
  database.run(`
    CREATE TABLE IF NOT EXISTS health_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      photo_url TEXT,
      analysis_data TEXT,
      recommendations TEXT,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // Таблица замечаний и правок пользователя
  database.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      context TEXT,
      target_id INTEGER,
      message TEXT NOT NULL,
      applied INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // Таблица долговременной памяти о пользователе (предпочтения, ограничения)
  database.run(`
    CREATE TABLE IF NOT EXISTS user_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // Индексы для быстрого поиска
  database.run(`CREATE INDEX IF NOT EXISTS idx_food_diary_user_date ON food_diary(user_id, date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_weight_logs_user ON weight_logs(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_health_analyses_user ON health_analyses(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id)`);

  saveDB();
  console.log('✅ База данных инициализирована');
}

export default { getDB, setupDatabase, saveDB };
