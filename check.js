import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import nodemailer from 'nodemailer';

const CATEGORIES = {
  desktop: 3,
  laptop: 4,
};

const SEEN_FILE = 'seen.json';
const CONFIG_FILE = 'config.json';
const BASE_URL = 'https://pcsrefurbished.com';

function loadConfig() {
  const defaults = {
    brands: ['apple', 'microsoft'],
    customKeywords: [],
    minRamGB: 0,
    minStorageGB: 0,
    checkIntervalMinutes: 120,
    lastCheckedAt: null,
  };
  try {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...defaults, ...fileConfig };
  } catch {
    return defaults;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

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

function extractSpecs(name) {
  let ramGB = null;
  let storageGB = null;

  const ramMatch = name.match(/(\d+)\s*GB\s*RAM/i);
  if (ramMatch) ramGB = parseInt(ramMatch[1], 10);

  const storageMatchGB = name.match(/(\d+)\s*GB\s*(SSD|HDD|NVME|EMMC)/i);
  const storageMatchTB = name.match(/(\d+)\s*TB\s*(SSD|HDD|NVME|EMMC)/i);
  if (storageMatchTB) {
    storageGB = parseInt(storageMatchTB[1], 10) * 1024;
  } else if (storageMatchGB) {
    storageGB = parseInt(storageMatchGB[1], 10);
  }

  return { ramGB, storageGB };
}

function isGoodDeal(product, config) {
  const name = product.name.toLowerCase();
  const keywords = [...(config.brands || []), ...(config.customKeywords || [])].map((k) =>
    k.toLowerCase()
  );

  if (keywords.length === 0) return false;
  const keywordMatch = keywords.some((kw) => kw && name.includes(kw));
  if (!keywordMatch) return false;

  const { ramGB, storageGB } = extractSpecs(product.name);

  const ramOk = !config.minRamGB || ramGB === null || ramGB >= config.minRamGB;
  const storageOk = !config.minStorageGB || storageGB === null || storageGB >= config.minStorageGB;

  return ramOk && storageOk;
}

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
    await transporter.sendMail({ from: user, to, subject, text: message });
    console.log('מייל נשלח בהצלחה');
  } catch (err) {
    console.error('שגיאה בשליחת מייל:', err.message);
  }
}

async function main() {
  const config = loadConfig();

  const now = Date.now();
  const lastRun = config.lastCheckedAt ? new Date(config.lastCheckedAt).getTime() : 0;
  const intervalMs = (config.checkIntervalMinutes || 120) * 60 * 1000;

  if (now - lastRun < intervalMs) {
    const minutesLeft = Math.round((intervalMs - (now - lastRun)) / 60000);
    console.log(`עדיין לא הגיע הזמן לבדיקה הבאה (נשארו כ-${minutesLeft} דקות). מדלגים.`);
    return;
  }

  const seen = loadSeen();
  const newGoodDeals = [];

  for (const [label, categoryId] of Object.entries(CATEGORIES)) {
    const products = await fetchCategoryProducts(categoryId);
    console.log(`${label}: נמצאו ${products.length} מוצרים`);

    for (const product of products) {
      if (!seen[product.id]) {
        seen[product.id] = { name: product.name, firstSeen: new Date().toISOString() };
        if (isGoodDeal(product, config)) {
          newGoodDeals.push(product);
        }
      }
    }
  }

  saveSeen(seen);

  config.lastCheckedAt = new Date().toISOString();
  saveConfig(config);

  if (newGoodDeals.length === 0) {
    console.log('אין מוצרים חדשים מתאימים הפעם.');
    return;
  }

  const lines = newGoodDeals.map((p) => `${p.name} - ${p.price || 'מחיר לא זמין'}\n${p.url}`);
  const message = `🖥️ נמצאו מחשבים חדשים ב-PCs for People:\n\n${lines.join('\n\n')}`;

  console.log(message);
  await sendWhatsApp(message);
  await sendEmail('נמצא מחשב טוב ב-PCs for People!', message);
}

main().catch((err) => {
  console.error('שגיאה כללית:', err);
  process.exit(1);
});
