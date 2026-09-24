# SpeakUp – AI English Tutor

A phone-first web app (installable PWA) for practising spoken English with Claude.

- **Talk** – voice conversation with a tutor that replies out loud; every sentence you say gets a correction card (fixes, a more natural version, words to learn).
- **Role-play** – job interviews (HR / hiring manager / "tell me about yourself"), client calls, stand-ups, escalations, presentations, salary negotiation, small talk or a custom scene, with a scored feedback report at the end.
- **Review** – saved mistakes as spaced-repetition flashcards (with "say it" pronunciation check), word of the day and your word list.
- **Progress** – streak, daily goal, sentences per day, accuracy, most common mistake types, role-play scores and estimated API cost.

Everything runs in the browser. Your Claude API key and your data are stored only on your device (localStorage) and are sent only to `api.anthropic.com`.

Voice input uses the browser's Web Speech API — best in Chrome on Android.
