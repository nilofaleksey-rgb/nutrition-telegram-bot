# Nutrition Telegram Bot

AI-powered nutrition assistant Telegram bot with KBJU tracking, food diary, and personalized recommendations.

## 🚀 Features

- 📊 User profile setup (height, weight, age, goal)
- 📝 Food diary with automatic KBJU calculation
- 🍽️ Food analysis from text input
- 📸 Photo analysis (planned)
- 🎤 Voice input support (planned)
- 📈 Daily and periodic reports
- 💡 AI nutritionist consultations
- 🔬 Medical test analysis
- ⚖️ Weight tracking

## 🛠️ Tech Stack

- Node.js
- Telegraf (Telegram Bot API)
- SQLite (sql.js)
- Axios

## 📦 Installation

```bash
npm install
```

## ⚙️ Configuration

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
DATABASE_PATH=./data/nutrition.db
```

## 🚀 Running

```bash
npm start
```

## 🐳 Docker

```bash
docker build -t nutrition-bot .
docker run -d --name nutrition-bot \
  -e TELEGRAM_BOT_TOKEN=your_token \
  nutrition-bot
```

## 📝 Deploy to Amvera

1. Fork this repository
2. Connect to Amvera via GitHub
3. Add environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `DATABASE_PATH=/app/data/nutrition.db`
4. Deploy!

## 📄 License

MIT
