import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import nodemailer from 'nodemailer';

// ====== הגדרות - כאן אפשר לשנות מה "מחשב טוב" מבחינתך ======
const CATEGORIES = {
  desktop: 3,
  laptop: 4,
};

// מילות מפתח שאם מופיעות בשם המוצר - זה נחשב "טוב" ומצדיק התראה
const KEYWORDS = ['apple', 'macbook', 'imac', 'microsoft', 'surface'];

const SEEN_FILE = 'seen.json';
const BASE_URL = 'https://pcsrefurbished.com';

// ====== שליפת מוצרים מקטגוריה מסוימת ======
async function fetchCategoryProducts(categoryId) {
  const url = `${BASE_URL}/sales/categorySales.aspx?categoryID=${categoryId}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PCsMonitorBot/1.0)' },
  });
  if (!res.ok) {
    console.error(`שגיאה בטעינת ${url}: ${res.status}`);
    return [];
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  // ממפים לפי productID - כל מוצר מופיע בכמה קישורים (תמונה, שם, מחיר)
  const productsById = {};

  $('a[href*="productPage"]').each((_, el) => {
    const href = $(el).attr('href');
    const idMatch = href && href.match(/productID=(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];
    const text = $(el).text().trim();

    if (!productsById[id]) {
      productsById[id] = {
        id,
        name: '',
        price: '',
        url: href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`,
      };
    }

    if (text.startsWith('$')) {
      productsById[id].price = text;
    } else if (text.length > 3 && !productsById[id].name) {
      productsById[id].name = text;
    }
  });

  return Object.values(productsById).filter((p) => p.name);
}

// ====== בדיקה אם מוצר מתאים למילות המפתח שלנו ======
function isGoodDeal(product) {
  const name = product.name.toLowerCase();
  return KEYWORDS.some((kw) => name.includes(kw));
}

// ====== טעינת/שמירת קובץ מצב (מה כבר ראינו) ======
function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

// ====== שליחת התראה בווטסאפ דרך CallMeBot ======
async function sendWhatsApp(message) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) {
    console.log('דילוג על ווטסאפ - חסרים CALLMEBOT_PHONE / CALLMEBOT_APIKEY');
    return;
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(
    message
  )}&apikey=${apikey}`;
  try {
    const res = await fetch(url);
    console.log('סטטוס שליחת ווטסאפ:', res.status);
  } catch (err) {
    console.error('שגיאה בשליחת ווטסאפ:', err.message);
  }
}

// ====== שליחת התראה במייל דרך Gmail ======
async function sendEmail(subject, message) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL || user;
  if (!user || !pass) {
    console.log('דילוג על מייל - חסרים GMAIL_USER / GMAIL_APP_PASSWORD');
    return;
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  try {
    await transporter.sendMail({
      from: user,
      to,
      subject,
      text: message,
    });
    console.log('מייל נשלח בהצלחה');
  } catch (err) {
    console.error('שגיאה בשליחת מייל:', err.message);
  }
}

// ====== ריצה ראשית ======
async function main() {
  const seen = loadSeen();
  const newGoodDeals = [];

  for (const [label, categoryId] of Object.entries(CATEGORIES)) {
    const products = await fetchCategoryProducts(categoryId);
    console.log(`${label}: נמצאו ${products.length} מוצרים`);

    for (const product of products) {
      if (!seen[product.id]) {
        seen[product.id] = { name: product.name, firstSeen: new Date().toISOString() };
        if (isGoodDeal(product)) {
          newGoodDeals.push(product);
        }
      }
    }
  }

  saveSeen(seen);

  if (newGoodDeals.length === 0) {
    console.log('אין מוצרים חדשים מתאימים הפעם.');
    return;
  }

  const lines = newGoodDeals.map(
    (p) => `${p.name} - ${p.price || 'מחיר לא זמין'}\n${p.url}`
  );
  const message = `🖥️ נמצאו מחשבים חדשים ב-PCs for People:\n\n${lines.join('\n\n')}`;

  console.log(message);
  await sendWhatsApp(message);
  await sendEmail('נמצא מחשב טוב ב-PCs for People!', message);
}

main().catch((err) => {
  console.error('שגיאה כללית:', err);
  process.exit(1);
});
