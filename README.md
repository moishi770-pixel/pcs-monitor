# עוקב מלאי - PCs for People

סקריפט שבודק כל שעתיים אם הופיע מחשב טוב (Apple/Microsoft) באתר
PCs for People (pcsrefurbished.com), ושולח לך התראה בווטסאפ ובמייל.

## איך זה עובד
1. GitHub Actions מריץ את הסקריפט לפי לוח זמנים (כל שעתיים כברירת מחדל).
2. הסקריפט נכנס לעמודי "Desktop" ו-"Laptop" באתר וקורא את כל המוצרים.
3. משווה מול קובץ `seen.json` (מה כבר ראינו) - כל מוצר חדש שמכיל
   בשמו אחת המילים: apple, macbook, imac, microsoft, surface - נחשב "מציאה".
4. אם נמצאה מציאה חדשה - נשלחת הודעת ווטסאפ ומייל, וה-`seen.json` מתעדכן.

## שלבי התקנה

### 1. הגדרת ווטסאפ (CallMeBot - חינמי)
1. שמור את המספר `+34 644 59 71 40` באנשי הקשר שלך בווטסאפ.
2. שלח לו הודעה: `I allow callmebot to send me messages`
3. הבוט יחזיר לך API key (מספר).
4. שמור את המספר שלך (עם קידומת מדינה, בלי +, למשל `19175551234`) ואת ה-API key.

### 2. הגדרת מייל (Gmail - חינמי)
1. היכנס לחשבון Gmail שלך > אבטחה > אימות דו-שלבי (חייב להיות פעיל).
2. צור "סיסמת אפליקציה" (App Password) לשימוש עם "Mail".
3. שמור את כתובת ה-Gmail ואת סיסמת האפליקציה (16 תווים).

### 3. הזנת הסודות (Secrets) בגיטהאב
בריפו: Settings > Secrets and variables > Actions > New repository secret.
צריך להוסיף:
- `CALLMEBOT_PHONE` - המספר שלך
- `CALLMEBOT_APIKEY` - המפתח שקיבלת מהבוט
- `GMAIL_USER` - כתובת ה-Gmail שלך
- `GMAIL_APP_PASSWORD` - סיסמת האפליקציה בת 16 התווים
- `NOTIFY_EMAIL` - לאיזה מייל לשלוח את ההתראה (אפשר להשאיר זהה ל-GMAIL_USER)

### 4. הפעלה
- ה-workflow ירוץ אוטומטית כל שעתיים.
- אפשר גם להריץ ידנית: טאב Actions > PCs for People Monitor > Run workflow.

## התאמות אפשריות
- לשנות תדירות: בקובץ `.github/workflows/check.yml`, בשורת ה-cron.
- להוסיף/להסיר מילות מפתח: ברשימת `KEYWORDS` בקובץ `check.js`.
