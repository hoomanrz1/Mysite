export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    if (url.pathname === '/property.html' || url.pathname === '/property') {
      return handlePropertyPage(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handlePropertyPage(request, env, url) {
  const assetResponse = await env.ASSETS.fetch(request);
  const id = url.searchParams.get('id');
  if (!id) return assetResponse;

  try {
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const property = data.find(p => p.id === id);
    if (!property) return assetResponse;

    const images = (property.images && property.images.length) ? property.images : (property.image ? [property.image] : []);
    const image = images[0] || '';
    const priceText = property.type === 'sale'
      ? `${property.price || ''} میلیارد تومان`
      : `ودیعه ${property.deposit || ''} / اجاره ${property.rentAmount || ''}`;
    const description = `${property.location || ''} — ${priceText}`.trim();
    const title = `${property.title || 'ملک'} | املاک راد`;
    const pageUrl = `https://realestaterezaei.ir/property.html?id=${id}`;

    const rewriter = new HTMLRewriter()
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

async function handleApi(request, env, url) {
  const cors = {
    'Content-Type': 'application/json'
  };

  // قیمت‌های لحظه‌ای (دلار، یورو، طلا، سکه) - با کش ۱۰ دقیقه‌ای برای صرفه‌جویی در سهمیه API
  if (url.pathname === '/api/prices' && request.method === 'GET') {
    try {
      const cached = await env.PROPERTIES_KV.get('prices_cache', 'json');
      if (cached && (Date.now() - cached.fetchedAt) < 2 * 60 * 1000) {
        return new Response(JSON.stringify(cached.data), { headers: cors });
      }

      const apiRes = await fetch('https://img.realestaterezaei.ir/prices');
      const raw = await apiRes.json();

      // حالت موقت برای دیباگ: با ?debug=1 داده خام رو نشون می‌ده
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
    return new Response(JSON.stringify(filtered), { headers: cors });
  }

  // دریافت یک ملک با شناسه (برای صفحه اختصاصی آگهی)
  if (url.pathname.startsWith('/api/properties/') && request.method === 'GET') {
    const id = url.pathname.split('/').pop();
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const property = data.find(p => p.id === id);
    if (!property) {
      return new Response(JSON.stringify({ error: 'ملک پیدا نشد' }), { status: 404, headers: cors });
    }
    return new Response(JSON.stringify(property), { headers: cors });
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

  return new Response(JSON.stringify({ error: 'مسیر پیدا نشد' }), { status: 404, headers: cors });
}

