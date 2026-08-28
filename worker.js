export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};

function isAuthed(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.includes(`admin_token=${env.ADMIN_PASSWORD}`);
}

async function handleApi(request, env, url) {
  const cors = {
    'Content-Type': 'application/json'
  };

  // قیمت‌های لحظه‌ای (دلار، یورو، طلا، سکه) - با کش ۱۰ دقیقه‌ای برای صرفه‌جویی در سهمیه API
  if (url.pathname === '/api/prices' && request.method === 'GET') {
    try {
      const cached = await env.PROPERTIES_KV.get('prices_cache', 'json');
      if (cached && (Date.now() - cached.fetchedAt) < 10 * 60 * 1000) {
        return new Response(JSON.stringify(cached.data), { headers: cors });
      }

      const apiRes = await fetch(`https://BrsApi.ir/Api/Market/Gold_Currency.php?key=${env.BRSAPI_KEY}`);
      const raw = await apiRes.json();

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
      return new Response(JSON.stringify({ error: 'خطا در دریافت قیمت‌ها' }), { status: 502, headers: cors });
    }
  }

  // ورود ادمین
  if (url.pathname === '/api/login' && request.method === 'POST') {
    const body = await request.json();
    if (body.password === env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          ...cors,
          'Set-Cookie': `admin_token=${env.ADMIN_PASSWORD}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`
        }
      });
    }
    return new Response(JSON.stringify({ success: false, error: 'رمز اشتباه است' }), { status: 401, headers: cors });
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
    return new Response(JSON.stringify({ authed: isAuthed(request, env) }), { headers: cors });
  }

  // آپلود عکس (فقط ادمین) - پروکسی امن به سمت VPS
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    if (!isAuthed(request, env)) {
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
    if (!isAuthed(request, env)) {
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
    if (!isAuthed(request, env)) {
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
    if (!isAuthed(request, env)) {
      return new Response(JSON.stringify({ error: 'ابتدا وارد شوید' }), { status: 401, headers: cors });
    }
    const id = url.pathname.split('/').pop();
    let data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    data = data.filter(p => p.id !== id);
    await env.PROPERTIES_KV.put('properties', JSON.stringify(data));
    return new Response(JSON.stringify({ success: true }), { headers: cors });
  }

  return new Response(JSON.stringify({ error: 'مسیر پیدا نشد' }), { status: 404, headers: cors });
}

