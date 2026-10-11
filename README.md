# 🥒 nutrition-telegram-bot

ИИ-ассистент по питанию для Telegram: расчёт нормы КБЖУ, дневник питания, анализ еды по фото и голосу,
отчёты, вес, анализы и консультации.

Пошаговая инструкция для запуска и деплоя на Amvera: **[docs/SETUP_RU.md](docs/SETUP_RU.md)**.

## Структура

```
main.py            точка входа
amvera.yml         конфиг деплоя на Amvera
requirements.txt   зависимости
bot/
  app.py           запуск бота (Telegram, база, ИИ)
  handlers.py      сценарии: онбординг, дневник, блюда, вес, отчёты, анализы, консультации
  keyboards.py     кнопки меню
  calc.py          расчёты: норма калорий, БЖУ, рекомендации, подбор ужина (без ИИ)
  parsing.py       разбор текста блюда: «Гречка 200 г 300 ккал Б10 Ж4 У55»
  db.py            SQLite: профили, дневник, вес, анализы
  ai.py            ИИ-функции: фото, консультации, анализы, оценка блюд
  llm.py           бэкенды нейросетей: GigaChat (основной) и OpenAI (запасной)
  charts.py        графики PNG: день, неделя, вес
tests/             тесты (python -m unittest discover -s tests -t .)
```

## Локальный запуск

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export BOT_TOKEN=...          # токен от @BotFather
export GIGACHAT_AUTH_KEY=...  # необязательно: без него ИИ-функции отключены (см. docs/SETUP_RU.md)
python main.py
```

Тесты (без сети и без реального Telegram/OpenAI):

```bash
python -m unittest discover -s tests -t .
```

Переменные окружения — в `.env.example`.
