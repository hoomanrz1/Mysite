export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // صفحه ملک: هم آدرس قدیمی (/property.html?id=...) هم آدرس جدید (/property/اسم-ملک-شناسه)
    if (
      url.pathname === '/property.html' ||
      url.pathname === '/property' ||
      url.pathname.startsWith('/property/')
    ) {
      const response = await handlePropertyPage(request, env, url);
      ctx.waitUntil(trackVisit(env, 'property'));
      return response;
    }

    const page = getPageName(url.pathname);
    if (page && request.method === 'GET') {
      ctx.waitUntil(trackVisit(env, page));
    }

    return env.ASSETS.fetch(request);
  }
};

function getPageName(pathname) {
  const map = {
    '/': 'home',
    '/index.html': 'home',
    '/sale.html': 'sale',
    '/sale': 'sale',
    '/rent.html': 'rent',
    '/rent': 'rent',
    '/about.html': 'about',
    '/about': 'about',
    '/calculator.html': 'calculator',
    '/calculator': 'calculator'
  };
  return map[pathname] || null;
}

async function trackVisit(env, page) {
  try {
    const stats = (await env.PROPERTIES_KV.get('site_stats', 'json')) || { total: 0, daily: {}, pages: {} };
    stats.total = (stats.total || 0) + 1;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }); // YYYY-MM-DD به وقت تهران
    stats.daily[today] = (stats.daily[today] || 0) + 1;
    stats.pages[page] = (stats.pages[page] || 0) + 1;

    // فقط ۳۰ روز اخیر رو نگه می‌داریم که حجم داده زیاد نشه
    const dates = Object.keys(stats.daily).sort();
    if (dates.length > 30) {
      dates.slice(0, dates.length - 30).forEach(d => delete stats.daily[d]);
    }

    await env.PROPERTIES_KV.put('site_stats', JSON.stringify(stats));
  } catch (err) {
    // ثبت آمار هیچ‌وقت نباید باعث خرابی سایت بشه، پس خطاش رو نادیده می‌گیریم
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// شناسه ملک رو از آخر آدرس درمیاره: /property/5000متر-شیخ-بهایی-1791810668073  ->  1791810668073
function extractIdFromPath(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    // اگه decode نشد، همون مسیر خام استفاده می‌شه
  }
  const match = decoded.match(/(\d{10,})\/?$/);
  return match ? match[1] : null;
}

// فایل property.html رو از دارایی‌های سایت می‌گیره (حتی اگه ریدایرکت بده، دنبالش می‌ره)
async function fetchPropertyAsset(request, env, url) {
  let res = await env.ASSETS.fetch(new Request(new URL('/property', url).toString(), request));
  if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
    res = await env.ASSETS.fetch(new Request(new URL(res.headers.get('Location'), url).toString(), request));
  }
  return res;
}

// لینک‌های نسبی (مثل index.html یا sale.html) رو مطلق می‌کنه تا توی آدرس /property/... هم درست کار کنن
function addRelativeUrlFixes(rewriter) {
  const fix = (attr) => ({
    element(el) {
      const v = el.getAttribute(attr);
      if (!v) return;
      // آدرس‌های مطلق، لینک‌های داخلی صفحه (#)، کوئری (?) و پروتکل‌دار (https:, tel:, mailto:, ...) دست نمی‌خورن
      if (/^(\/|#|\?|[a-z][a-z0-9+.\-]*:)/i.test(v)) return;
      el.setAttribute(attr, '/' + v);
    }
  });
  return rewriter
    .on('a[href]', fix('href'))
    .on('link[href]', fix('href'))
    .on('script[src]', fix('src'))
    .on('img[src]', fix('src'))
    .on('source[src]', fix('src'));
}

async function handlePropertyPage(request, env, url) {
  const isSlugUrl = url.pathname.startsWith('/property/');
  const assetResponse = isSlugUrl
    ? await fetchPropertyAsset(request, env, url)
    : await env.ASSETS.fetch(request);

  const rewriter = new HTMLRewriter();
  if (isSlugUrl) addRelativeUrlFixes(rewriter);

  const id = url.searchParams.get('id') || (isSlugUrl ? extractIdFromPath(url.pathname) : null);

  let property = null;
  if (id) {
    try {
      const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
      property = data.find(p => p.id === id) || null;
    } catch (err) {
      property = null;
    }
  }

  if (property) {
    const images = (property.images && property.images.length) ? property.images : (property.image ? [property.image] : []);
    const image = images[0] || '';
    const priceText = property.type === 'sale'
      ? `${property.price || ''} میلیارد تومان`
      : `ودیعه ${property.deposit || ''} / اجاره ${property.rentAmount || ''}`;
    const description = `${property.location || ''} — ${priceText}`.trim();
    const title = `${property.title || 'ملک'} | املاک راد`;
    const pageUrl = isSlugUrl
      ? `https://realestaterezaei.ir${url.pathname}`
      : `https://realestaterezaei.ir/property.html?id=${id}`;

    rewriter
      .on('title', {
        element(el) {
          el.setInnerContent(title);
        }
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute('content', description);
        }
      })
      .on('head', {
        element(el) {
          // برای آدرس‌های جدید: شناسه ملک رو به آدرس مرورگر اضافه می‌کنه تا کد صفحه بتونه پیداش کنه
          if (isSlugUrl) {
            el.prepend(
              `<script>try{var u=new URL(location.href);if(!u.searchParams.get('id')){u.searchParams.set('id','${escapeHtml(id)}');history.replaceState(null,'',u.pathname+u.search+u.hash);}}catch(e){}</script>`,
              { html: true }
            );
          }

          let tags = `
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">`;
          if (image) {
            tags += `
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(image)}">`;
          }
          el.append(tags, { html: true });
        }
      });
  }

  // آدرس قدیمی بدون ملک پیدا شده نیازی به تغییر ندارد
  if (!isSlugUrl && !property) return assetResponse;

  try {
    return rewriter.transform(assetResponse);
  } catch (err) {
    return assetResponse;
  }
}

async function hashPassword(pw) {
  const data = new TextEncoder().encode(pw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getCurrentPasswordHash(env) {
  let hash = await env.PROPERTIES_KV.get('admin_password_hash');
  if (!hash) {
    hash = await hashPassword(env.ADMIN_PASSWORD);
    await env.PROPERTIES_KV.put('admin_password_hash', hash);
  }
  return hash;
}

async function isAuthed(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/admin_token=([a-f0-9]+)/);
  if (!match) return false;
  const currentHash = await getCurrentPasswordHash(env);
  return match[1] === currentHash;
}

// اطلاعات خصوصی (مثل مالک ملک) هرگز نباید به بازدیدکننده‌ی عمومی سایت برسه
function stripPrivateFields(property) {
  const { ownerId, ...rest } = property;
  return rest;
}

async function handleApi(request, env, url) {
  const cors = {
    'Content-Type': 'application/json'
  };

  // ثبت بازدید صفحه (عمومی - هرکسی که سایت رو باز کنه، یه بار درخواست می‌فرسته)
  if (url.pathname === '/api/track' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const page = (body.page || 'unknown').toString().slice(0, 50);
      const today = new Date().toISOString().slice(0, 10);

      const stats = (await env.PROPERTIES_KV.get('site_stats', 'json')) || { total: 0, daily: {}, pages: {} };
      stats.total = (stats.total || 0) + 1;
      stats.daily = stats.daily || {};
      stats.daily[today] = (stats.daily[today] || 0) + 1;
      stats.pages = stats.pages || {};
      stats.pages[page] = (stats.pages[page] || 0) + 1;

      const dailyKeys = Object.keys(stats.daily).sort();
      if (dailyKeys.length > 90) {
        dailyKeys.slice(0, dailyKeys.length - 90).forEach(k => delete stats.daily[k]);
      }

      await env.PROPERTIES_KV.put('site_stats', JSON.stringify(stats));
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ success: false }), { headers: cors });
    }
  }

  // آمار بازدید سایت (فقط ادمین)
  if (url.pathname === '/api/stats' && request.method === 'GET') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const stats = (await env.PROPERTIES_KV.get('site_stats', 'json')) || { total: 0, daily: {}, pages: {} };
    return new Response(JSON.stringify(stats), { headers: cors });
  }

  // قیمت‌های لحظه‌ای (دلار، یورو، طلا، سکه) - با کش ۲ دقیقه‌ای برای صرفه‌جویی در سهمیه API
  if (url.pathname === '/api/prices' && request.method === 'GET') {
    try {
      const cached = await env.PROPERTIES_KV.get('prices_cache', 'json');
      if (cached && (Date.now() - cached.fetchedAt) < 2 * 60 * 1000) {
        return new Response(JSON.stringify(cached.data), { headers: cors });
      }

      const apiRes = await fetch('https://img.realestaterezaei.ir/prices');
      const raw = await apiRes.json();

      if (url.searchParams.get('debug') === '1') {
        return new Response(JSON.stringify(raw, null, 2), { headers: cors });
      }

      const currencyList = raw.currency || raw.Currency || [];
      const goldList = raw.gold || raw.Gold || [];

      function findItem(list, matchers) {
        return list.find(item => {
          const text = `${item.symbol || ''} ${item.name || ''} ${item.name_en || ''}`.toLowerCase();
          return matchers.some(m => text.includes(m.toLowerCase()));
        });
      }

      const usd = findItem(currencyList, ['usd', 'دلار']);
      const eur = findItem(currencyList, ['eur', 'یورو']);
      const gold18 = findItem(goldList, ['18', 'هجده']);
      const sekkeh = goldList.find(item => {
        const text = `${item.name || ''}`;
        return text.includes('سکه') && !text.includes('نیم') && !text.includes('ربع') && !text.includes('گرمی');
      });

      const result = {
        usd: usd ? { price: usd.price, change: usd.change_percent } : null,
        eur: eur ? { price: eur.price, change: eur.change_percent } : null,
        gold18: gold18 ? { price: gold18.price, change: gold18.change_percent } : null,
        sekkeh: sekkeh ? { price: sekkeh.price, change: sekkeh.change_percent } : null,
        updatedAt: Date.now()
      };

      await env.PROPERTIES_KV.put('prices_cache', JSON.stringify({ data: result, fetchedAt: Date.now() }));
      return new Response(JSON.stringify(result), { headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'خطا در دریافت قیمت‌ها', debug: err.message, hasKey: !!env.BRSAPI_KEY }), { status: 502, headers: cors });
    }
  }

  // ورود ادمین
  if (url.pathname === '/api/login' && request.method === 'POST') {
    const body = await request.json();
    const currentHash = await getCurrentPasswordHash(env);
    const inputHash = await hashPassword(body.password);
    if (inputHash === currentHash) {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          ...cors,
          'Set-Cookie': `admin_token=${currentHash}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`
        }
      });
    }
    return new Response(JSON.stringify({ success: false, error: 'رمز اشتباه است' }), { status: 401, headers: cors });
  }

  // تغییر رمز عبور (فقط ادمین وارد شده)
  if (url.pathname === '/api/change-password' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const { oldPassword, newPassword } = await request.json();
    if (!newPassword || newPassword.length < 4) {
      return new Response(JSON.stringify({ error: 'رمز جدید باید حداقل ۴ کاراکتر باشد' }), { status: 400, headers: cors });
    }
    const currentHash = await getCurrentPasswordHash(env);
    const oldHash = await hashPassword(oldPassword || '');
    if (oldHash !== currentHash) {
      return new Response(JSON.stringify({ error: 'رمز فعلی اشتباه است' }), { status: 401, headers: cors });
    }
    const newHash = await hashPassword(newPassword);
    await env.PROPERTIES_KV.put('admin_password_hash', newHash);
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        ...cors,
        'Set-Cookie': `admin_token=${newHash}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`
      }
    });
  }

  // خروج از پنل مدیریت
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        ...cors,
        'Set-Cookie': `admin_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`
      }
    });
  }

  // بررسی وضعیت ورود
  if (url.pathname === '/api/check-auth' && request.method === 'GET') {
    return new Response(JSON.stringify({ authed: await isAuthed(request, env) }), { headers: cors });
  }

  // آپلود عکس (فقط ادمین) - پروکسی امن به سمت VPS
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    try {
      const contentType = request.headers.get('Content-Type') || '';
      const uploadRes = await fetch('https://img.realestaterezaei.ir/upload', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'x-upload-secret': env.VPS_UPLOAD_SECRET
        },
        body: request.body
      });
      const result = await uploadRes.json();
      return new Response(JSON.stringify(result), { status: uploadRes.status, headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'خطا در اتصال به سرور عکس' }), { status: 502, headers: cors });
    }
  }

  // دریافت لیست املاک (عمومی - همه می‌تونن ببینن)
  if (url.pathname === '/api/properties' && request.method === 'GET') {
    const type = url.searchParams.get('type');
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const filtered = type ? data.filter(p => p.type === type) : data;
    const authed = await isAuthed(request, env);
    const output = authed ? filtered : filtered.map(stripPrivateFields);
    return new Response(JSON.stringify(output), { headers: cors });
  }

  // دریافت یک ملک با شناسه (برای صفحه اختصاصی آگهی)
  if (url.pathname.startsWith('/api/properties/') && request.method === 'GET') {
    const id = url.pathname.split('/').pop();
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const property = data.find(p => p.id === id);
    if (!property) {
      return new Response(JSON.stringify({ error: 'ملک پیدا نشد' }), { status: 404, headers: cors });
    }
    const authed = await isAuthed(request, env);
    return new Response(JSON.stringify(authed ? property : stripPrivateFields(property)), { headers: cors });
  }

  // افزودن ملک جدید (فقط ادمین)
  if (url.pathname === '/api/properties' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const newProperty = await request.json();
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    newProperty.id = Date.now().toString();
    data.unshift(newProperty);
    await env.PROPERTIES_KV.put('properties', JSON.stringify(data));
    return new Response(JSON.stringify({ success: true, id: newProperty.id }), { headers: cors });
  }

  // ویرایش ملک (فقط ادمین)
  if (url.pathname.startsWith('/api/properties/') && request.method === 'PUT') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    const updates = await request.json();
    let data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const index = data.findIndex(p => p.id === id);
    if (index === -1) {
      return new Response(JSON.stringify({ error: 'ملک پیدا نشد' }), { status: 404, headers: cors });
    }
    data[index] = { ...data[index], ...updates, id };
    await env.PROPERTIES_KV.put('properties', JSON.stringify(data));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  // حذف ملک (فقط ادمین)
  if (url.pathname.startsWith('/api/properties/') && request.method === 'DELETE') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    let data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    data = data.filter(p => p.id !== id);
    await env.PROPERTIES_KV.put('properties', JSON.stringify(data));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  // دریافت لیست مشتری‌ها (فقط ادمین - اطلاعات خصوصی)
  if (url.pathname === '/api/customers' && request.method === 'GET') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const customers = (await env.PROPERTIES_KV.get('customers', 'json')) || [];
    return new Response(JSON.stringify(customers), { headers: cors });
  }

  // افزودن مشتری جدید (فقط ادمین)
  if (url.pathname === '/api/customers' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const newCustomer = await request.json();
    const customers = (await env.PROPERTIES_KV.get('customers', 'json')) || [];
    newCustomer.id = Date.now().toString();
    customers.unshift(newCustomer);
    await env.PROPERTIES_KV.put('customers', JSON.stringify(customers));
    return new Response(JSON.stringify({ success: true, id: newCustomer.id }), { headers: cors });
  }

  // ویرایش مشتری (فقط ادمین)
  if (url.pathname.startsWith('/api/customers/') && request.method === 'PUT') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    const updates = await request.json();
    let customers = (await env.PROPERTIES_KV.get('customers', 'json')) || [];
    const index = customers.findIndex(c => c.id === id);
    if (index === -1) {
      return new Response(JSON.stringify({ error: 'مشتری پیدا نشد' }), { status: 404, headers: cors });
    }
    customers[index] = { ...customers[index], ...updates, id };
    await env.PROPERTIES_KV.put('customers', JSON.stringify(customers));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  // حذف مشتری (فقط ادمین)
  if (url.pathname.startsWith('/api/customers/') && request.method === 'DELETE') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    let customers = (await env.PROPERTIES_KV.get('customers', 'json')) || [];
    customers = customers.filter(c => c.id !== id);
    await env.PROPERTIES_KV.put('customers', JSON.stringify(customers));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  // دریافت لیست مالکین (فقط ادمین - کاملاً خصوصی)
  if (url.pathname === '/api/owners' && request.method === 'GET') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const owners = (await env.PROPERTIES_KV.get('owners', 'json')) || [];
    return new Response(JSON.stringify(owners), { headers: cors });
  }

  // افزودن مالک جدید (فقط ادمین)
  if (url.pathname === '/api/owners' && request.method === 'POST') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const newOwner = await request.json();
    const owners = (await env.PROPERTIES_KV.get('owners', 'json')) || [];
    newOwner.id = Date.now().toString();
    owners.unshift(newOwner);
    await env.PROPERTIES_KV.put('owners', JSON.stringify(owners));
    return new Response(JSON.stringify({ success: true, id: newOwner.id }), { headers: cors });
  }

  // ویرایش مالک (فقط ادمین)
  if (url.pathname.startsWith('/api/owners/') && request.method === 'PUT') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    const updates = await request.json();
    let owners = (await env.PROPERTIES_KV.get('owners', 'json')) || [];
    const index = owners.findIndex(o => o.id === id);
    if (index === -1) {
      return new Response(JSON.stringify({ error: 'مالک پیدا نشد' }), { status: 404, headers: cors });
    }
    owners[index] = { ...owners[index], ...updates, id };
    await env.PROPERTIES_KV.put('owners', JSON.stringify(owners));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  // حذف مالک (فقط ادمین)
  if (url.pathname.startsWith('/api/owners/') && request.method === 'DELETE') {
    if (!(await isAuthed(request, env))) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    let owners = (await env.PROPERTIES_KV.get('owners', 'json')) || [];
    owners = owners.filter(o => o.id !== id);
    await env.PROPERTIES_KV.put('owners', JSON.stringify(owners));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  return new Response(JSON.stringify({ error: 'مسیر پیدا نشد' }), { status: 404, headers: cors });
}
