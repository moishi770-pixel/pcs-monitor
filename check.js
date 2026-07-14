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
    cpuBrands: [],
    minCpuTier: 0,
    minRamGB: 0,
    minStorageGB: 0,
    checkIntervalMinutes: 120,
    lastCheckedAt: null,
    forceCheck: false,
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

function resolveUrl(src) {
  if (!src) return null;
  if (src.startsWith('http')) return src;
  return `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
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
        image: null,
        url: resolveUrl(href),
      };
    }

    if (text.startsWith('$')) {
      productsById[id].price = text;
    } else if (text.length > 3 && !productsById[id].name) {
      productsById[id].name = text;
    }

    if (!productsById[id].image) {
      const imgEl = $(el).find('img').first();
      if (imgEl.length) {
        const src = imgEl.attr('src') || imgEl.attr('data-src');
        if (src) productsById[id].image = resolveUrl(src);
      }
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

  let cpuBrand = null;
  let cpuTier = null;
  if (/ryzen/i.test(name)) cpuBrand = 'amd';
  else if (/\bi[3579]\b|intel|core/i.test(name)) cpuBrand = 'intel';
  else if (/\bm[1-4]\b|apple silicon/i.test(name)) cpuBrand = 'apple';

  const intelMatch = name.match(/i([3579])/i);
  const ryzenMatch = name.match(/ryzen\D{0,4}([3579])/i);
  if (intelMatch) cpuTier = parseInt(intelMatch[1], 10);
  else if (ryzenMatch) cpuTier = parseInt(ryzenMatch[1], 10);
  else if (/\bm[1-4]\b/i.test(name)) cpuTier = 9;

  return { ramGB, storageGB, cpuBrand, cpuTier };
}

function isGoodDeal(product, config) {
  const name = product.name.toLowerCase();
  const keywords = [...(config.brands || []), ...(config.customKeywords || [])].map((k) =>
    k.toLowerCase()
  );

  if (keywords.length === 0) return false;
  const keywordMatch = keywords.some((kw) => kw && name.includes(kw));
  if (!keywordMatch) return false;

  const { ramGB, storageGB, cpuBrand, cpuTier } = extractSpecs(product.name);

  const ramOk = !config.minRamGB || ramGB === null || ramGB >= config.minRamGB;
  const storageOk = !config.minStorageGB || storageGB === null || storageGB >= config.minStorageGB;
  const cpuBrandOk =
    !(config.cpuBrands && config.cpuBrands.length) || cpuBrand === null || config.cpuBrands.includes(cpuBrand);
  const cpuTierOk = !config.minCpuTier || cpuTier === null || cpuTier >= config.minCpuTier;

  return ramOk && storageOk && cpuBrandOk && cpuTierOk;
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

async function sendEmail(subject, textMessage, products) {
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

  const htmlCards = products
    .map(
      (p) => `
      <div style="border:1px solid #e2e4ea;border-radius:12px;padding:14px;margin-bottom:14px;font-family:sans-serif;">
        ${p.image ? `<img src="${p.image}" alt="${p.name}" style="max-width:100%;border-radius:8px;margin-bottom:10px;" />` : ''}
        <div style="font-weight:600;font-size:15px;">${p.name}</div>
        <div style="color:#b5691f;font-weight:600;margin:4px 0;">${p.price || 'מחיר לא זמין'}</div>
        <a href="${p.url}" style="color:#2563eb;">לצפייה במוצר באתר</a>
      </div>`
    )
    .join('');

  const html = `<div dir="rtl" style="max-width:480px;">
    <h2 style="font-family:sans-serif;">🖥️ נמצאו מחשבים חדשים ב-PCs for People</h2>
    ${htmlCards}
  </div>`;

  try {
    await transporter.sendMail({ from: user, to, subject, text: textMessage, html });
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

  if (!config.forceCheck && now - lastRun < intervalMs) {
    const minutesLeft = Math.round((intervalMs - (now - lastRun)) / 60000);
    console.log(`עדיין לא הגיע הזמן לבדיקה הבאה (נשארו כ-${minutesLeft} דקות). מדלגים.`);
    return;
  }
  if (config.forceCheck) {
    console.log('בדיקה ידנית הופעלה מהדשבורד - מדלגים על בדיקת התדירות.');
  }

  const seen = loadSeen();
  const newGoodDeals = [];

  for (const [label, categoryId] of Object.entries(CATEGORIES)) {
    const products = await fetchCategoryProducts(categoryId);
    console.log(`${label}: נמצאו ${products.length} מוצרים`);

    for (const product of products) {
      if (!seen[product.id]) {
        seen[product.id] = {
          name: product.name,
          image: product.image,
          firstSeen: new Date().toISOString(),
        };
        if (isGoodDeal(product, config)) {
          newGoodDeals.push(product);
        }
      }
    }
  }

  saveSeen(seen);

  config.lastCheckedAt = new Date().toISOString();
  config.forceCheck = false;
  saveConfig(config);

  if (newGoodDeals.length === 0) {
    console.log('אין מוצרים חדשים מתאימים הפעם.');
    return;
  }

  const lines = newGoodDeals.map((p) => `${p.name} - ${p.price || 'מחיר לא זמין'}\n${p.url}`);
  const message = `🖥️ נמצאו מחשבים חדשים ב-PCs for People:\n\n${lines.join('\n\n')}`;

  console.log(message);
  await sendWhatsApp(message);
  await sendEmail('נמצא מחשב טוב ב-PCs for People!', message, newGoodDeals);
}

main().catch((err) => {
  console.error('שגיאה כללית:', err);
  process.exit(1);
});
