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

  // بررسی وضعیت ورود
  if (url.pathname === '/api/check-auth' && request.method === 'GET') {
    return new Response(JSON.stringify({ authed: isAuthed(request, env) }), { headers: cors });
  }

  // دریافت لیست املاک (عمومی - همه می‌تونن ببینن)
  if (url.pathname === '/api/properties' && request.method === 'GET') {
    const type = url.searchParams.get('type');
    const data = (await env.PROPERTIES_KV.get('properties', 'json')) || [];
    const filtered = type ? data.filter(p => p.type === type) : data;
    return new Response(JSON.stringify(filtered), { headers: cors });
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
