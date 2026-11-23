// Throwaway mock of the dashboards API contract (never committed). node qa-tmp/mock-api.mjs [port] [--disabled] [--fail=tasks,events,summary]
import http from 'node:http';
import { randomUUID } from 'node:crypto';
const port = Number(process.argv[2] || 8799);
const disabled = process.argv.includes('--disabled');
const fail = new Set((process.argv.find((a) => a.startsWith('--fail=')) || '').slice(7).split(',').filter(Boolean));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const areas = [['money', 'Деньги', 'Money'], ['work-income', 'Работа и доход', 'Work and income'], ['court-paperwork', 'Суд и бумаги', 'Court and paperwork'], ['health-sport', 'Здоровье и спорт', 'Health and sport'], ['romantic', 'Романтические отношения', 'Romantic relationships'], ['friends', 'Друзья', 'Friends'], ['family', 'Семья', 'Family'], ['travel', 'Путешествия', 'Travel'], ['home', 'Дом', 'Home'], ['hobbies-growth', 'Хобби и рост', 'Hobbies and growth']].map(([id, ru, en], i) => ({ id, space_id: 'personal', name_ru: ru, name_en: en, sort: i }));
const projects = [{ id: 'garden', name: 'Garden', archived: false, icon: 'leaf' }, { id: 'court', name: 'Court case', archived: false, icon: 'scales' }, { id: 'side-project', name: 'Side project', archived: false, icon: null }];
let n = 0;
const T = (space, title, o = {}) => ({ id: randomUUID(), space_id: space, title, notes: '', area_id: null, priority: false, due_date: null, status: 'open', done_at: null, source: 'web', created_at: new Date(Date.now() - (100 - n++) * 60000).toISOString(), updated_at: new Date().toISOString(), ...o });
const tasks = [
  T('personal', 'Оплатить счёт за электричество', { priority: true, due_date: day(-2), area_id: 'money' }),
  T('personal', 'Позвонить в клинику, чтобы перенести приём', { priority: true, due_date: day(0), area_id: 'health-sport' }),
  T('personal', 'Отправить подписанную форму', { due_date: day(0), area_id: 'court-paperwork' }),
  T('personal', 'Забронировать столик на субботу', { due_date: day(3), area_id: 'romantic' }),
  T('personal', 'Выставить инвойс', { due_date: day(2), area_id: 'work-income', notes: 'Клиент ждёт до пятницы' }),
  T('personal', 'Собрать документы в одну папку', { due_date: day(20), area_id: 'court-paperwork' }),
  T('personal', 'Придумать идею для отпуска', {}),
  T('personal', 'Записаться на стрижку', { status: 'done', done_at: new Date(Date.now() - 86400000).toISOString(), area_id: 'home' }),
  T('work-1', 'Ревью PR 123', { priority: true, due_date: day(0) }),
  T('work-1', 'Смержить PR с документацией', { due_date: day(1) }),
  T('work-1', 'Обновить оценки', {}),
  T('work-1', '[EX-101] Починить нестабильный прогон', { source: 'linear', stage: 'started', url: 'https://linear.app/x/1', due_date: day(1) }),
  T('work-1', '[EX-102] Добавить проверки схемы', { source: 'linear', stage: 'started', url: 'https://linear.app/x/2' }),
  T('work-1', '[EX-103] Описать формат событий', { source: 'linear', stage: 'unstarted', url: 'https://linear.app/x/3', due_date: day(4) }),
  T('work-1', '[EX-104] Разобрать очередь', { source: 'linear', stage: 'backlog', url: 'https://linear.app/x/4' }),
  T('work-1', '#123 Пример изменения: добавить проверки', { source: 'github', stage: 'review', url: 'https://github.com/example/repo/pull/123' }),
  T('work-1', '#124 Настройки зашиты в код', { source: 'github', stage: 'mine', url: 'https://github.com/example/repo/pull/124' }),
  Object.assign(T('', 'Купить семена', { priority: true, due_date: day(-1) }), {}),
  T('work-2', 'Продление контракта: дождаться ответа', { priority: true, due_date: day(4) }),
];
for (const [title,o] of [['Купить семена',{priority:true,due_date:day(-1)}],['Полить грядки',{due_date:day(0)}],['Построить сарай',{due_date:day(30)}],['Набросать план',{}]]) { const t = T('', title, o); delete t.space_id; t.project_id = 'garden'; tasks.push(t); }
const at = (d, hh, mm = 0, len = 60) => { const s = new Date(); s.setDate(s.getDate() + d); s.setHours(hh, mm, 0, 0); return [s.toISOString(), new Date(s.getTime() + len * 60000).toISOString()]; };
const mk = (space, title, d, hh, mm, len, busy = false) => { const [s, e] = at(d, hh, mm, len); return { id: randomUUID(), space_id: space, title, starts_at: s, ends_at: e, busy_only: busy, source: 'web', created_at: s, updated_at: s }; };
const events = [mk('work-1', 'Стендап команды', 0, 10, 0, 30), mk('work-1', 'Онбординг-синк', 0, 13), mk('personal', 'Тренировка', 0, 18), mk('personal', 'Врач', 1, 11, 0, 60, true), mk('work-1', 'Планирование', 1, 11), mk('work-2', 'Синк по проекту', 2, 15, 30), mk('personal', 'Урок языка', 3, 19, 30)];
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body === null ? '' : JSON.stringify(body)); };
const err = (res, code, error, message) => send(res, code, { error, message, request_id: 'mock' });
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname.replace('/api/dashboards/v1', '');
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}; const m = (re) => re.exec(p);
    setTimeout(() => {
      if (p === '/bootstrap') return send(res, 200, disabled ? { enabled: false } : { enabled: true, spaces: [{ id: 'personal' }, { id: 'work-1', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABqElEQVR4nO3cQU5DUQxD0a6ElbBE9lymqKJSC+/HdnwtZdw4Z4b47/bx+XVndHNTL9A+AADQPQAA0D0AANA9AADQPQAA0D0AANA9MQDvRr1vPMDpqPtEAExF3dMOQBV1bzmAS+oAXFMB4J7VAClZCZCWNQDpiQbYEgDEiQRQHkL52xYATsWddhkBcC3rutdRAMeC7jtaAVx9fMc9jwG4FErbWQ6gOr7L3kcA1CWS9wcgHSD9+OoeEgD1sZ26AJAMsOn4qk4ANAGoj+vYC4BUgL9EfVjHbmMA6qO69gMAAM8BAACPBQEAAAAAAAAAAACyAZIQJrvxxzhxLwCaABIQpjsBkAywDUHRBYBGAEcEVQ/+NVG8PwAbANQlkveWAygRHHbmEyXxnlYAp8sl7MhnquK9+FB7cJcxgNPF3z2A8rdtAK46hCJX3giAFxILsAHh6vvwZNmTTN2FR/t+yeRNeLbyIdP34OHWH1HcgqeL74VPF7tAqHvbAExDqHvaAlyJoe4TB/BfEPW+6wC2DgAAdA8AAHQPAAB0DwAAdA8AAHQPAAB0DwDi+QZzvHa8+uDF7wAAAABJRU5ErkJggg==' }, { id: 'work-2' }], projects: projects.filter((q) => !q.archived).map(({ id, name, icon }) => ({ id, name, icon })), areas, server_time: new Date().toISOString() });
      if (p === '/summary') { if (fail.has('summary')) return err(res, 500, 'internal_error', 'x');
        const out = {}; for (const s of ['personal', 'work-1', 'work-2']) { const t = tasks.filter((x) => x.space_id === s && x.status === 'open'); const nx = events.filter((e) => e.space_id === s && new Date(e.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
          out[s] = { open: t.length, priority: t.filter((x) => x.priority).length, overdue: t.filter((x) => x.due_date && x.due_date < day(0)).length, next_event: nx ? { title: nx.title, starts_at: nx.starts_at } : null }; }
        return send(res, 200, { spaces: out }); }
      if (p === '/projects') { if (req.method === 'GET') return send(res, 200, { projects: projects.map((q) => { const t = tasks.filter((x) => x.project_id === q.id && x.status === 'open'); return { ...q, open: t.length, priority: t.filter((x) => x.priority).length, overdue: t.filter((x) => x.due_date && x.due_date < day(0)).length }; }) });
        const name = String(body.name || '').trim(); if (projects.some((q) => q.name.toLowerCase() === name.toLowerCase())) return err(res, 409, 'conflict', 'x'); const q = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, archived: false, icon: typeof body.icon === 'string' ? body.icon : null }; projects.push(q); return send(res, 201, { ...q, open: 0, priority: 0, overdue: 0 }); }
      let r;
      if ((r = /^\/projects\/([\w-]+)$/.exec(p)) && req.method === 'PATCH') { const q = projects.find((x) => x.id === r[1]); Object.assign(q, body); return send(res, 200, { ...q, open: 0, priority: 0, overdue: 0 }); }
      if ((r = /^\/projects\/([\w-]+)\/tasks(?:\/([\w-]+))?$/.exec(p))) { if (!r[2] && req.method === 'GET') return send(res, 200, tasks.filter((x) => x.project_id === r[1])); if (!r[2]) { const t = T('', body.title, {}); delete t.space_id; t.project_id = r[1]; tasks.push(t); return send(res, 201, t); } const t = tasks.find((x) => x.id === r[2]); if (req.method === 'PATCH') { Object.assign(t, body); return send(res, 200, t); } tasks.splice(tasks.indexOf(t), 1); return send(res, 204, null); }
      if ((r = m(/^\/spaces\/([\w-]+)\/tasks$/))) {
        if (req.method === 'GET') { if (fail.has('tasks')) return err(res, 500, 'internal_error', 'x'); const st = url.searchParams.get('status') || 'open'; return send(res, 200, tasks.filter((x) => x.space_id === r[1] && (st === 'all' || x.status === st))); }
        if (req.method === 'POST') { if (fail.has('create')) return err(res, 500, 'internal_error', 'x'); const t = T(r[1], body.title, { notes: body.notes || '', area_id: body.area_id || null, priority: !!body.priority, due_date: body.due_date || null }); tasks.push(t); return send(res, 201, t); } }
      if ((r = m(/^\/tasks\/([\w-]+)$/))) { const t = tasks.find((x) => x.id === r[1]); if (!t) return err(res, 404, 'not_found', 'x');
        if (req.method === 'PATCH') { if (fail.has('patch')) return err(res, 500, 'internal_error', 'x'); Object.assign(t, body, { updated_at: new Date().toISOString() }); if ('status' in body) t.done_at = body.status === 'done' ? new Date().toISOString() : null; return send(res, 200, t); }
        if (req.method === 'DELETE') { tasks.splice(tasks.indexOf(t), 1); return send(res, 204, null); } }
      if (p === '/events' && req.method === 'GET') { if (fail.has('events')) return err(res, 500, 'internal_error', 'x'); const f = url.searchParams.get('from'), t = url.searchParams.get('to'); return send(res, 200, events.filter((e) => e.starts_at.slice(0, 10) >= f && e.starts_at.slice(0, 10) <= t || (new Date(e.starts_at) >= new Date(f) && new Date(e.starts_at) <= new Date(t + 'T23:59:59')))); }
      if ((r = m(/^\/spaces\/([\w-]+)\/events$/)) && req.method === 'POST') { const e = { id: randomUUID(), space_id: r[1], title: body.title, starts_at: body.starts_at, ends_at: body.ends_at, busy_only: !!body.busy_only, source: 'web', created_at: body.starts_at, updated_at: body.starts_at }; events.push(e); return send(res, 201, e); }
      err(res, 404, 'not_found', 'x');
    }, 60);
  });
}).listen(port, '127.0.0.1', () => console.log('mock on', port));
