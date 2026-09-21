#!/usr/bin/env node
// Подпись фото/видео в Telegram-теме объекта: «объект · работа · кто».
//
// Панель подписывала бэкап одним именем объекта, и в теме с сотней снимков было не
// понять, к какой работе фото (просьба заказчика 21.09.2026). Бот так уже делал.
import fs from 'node:fs'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const p = boot({})
p.set({
  users: [{ id: 'valera', name: 'Валера', roles: ['brigadier'] }],
  objects: [{ id: 'o1', name: 'Баня Буханка', stages: [{ id: 's1', n: 'ЭТАП 1', works: [{ id: 'w1', n: 'Разводка электрики кабелем' }] }] }],
})
p.run('currentUser=users[0];')

t.section('Подпись называет работу')
t.ok('фото работы', p.run('tgMediaCaption(objects[0],"w1")') === 'Баня Буханка · Разводка электрики кабелем · Валера', p.run('tgMediaCaption(objects[0],"w1")'))
t.ok('видео — по имени работы', p.run('tgMediaCaption(objects[0],"","Монтаж перегородок")') === 'Баня Буханка · Монтаж перегородок · Валера')
t.ok('фото объекта без работы — без пустых точек', p.run('tgMediaCaption(objects[0],"")') === 'Баня Буханка · Валера')

t.section('Все загрузки фото работы передают работу')
{
  const src = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8')
  const calls = src.match(/mirrorPhotosToTelegram\([^)]*\);/g) || []
  t.ok('вызовы найдены', calls.length >= 4, String(calls.length))
  t.ok('в каждом есть wid', calls.every(c => /,\s*wid\)/.test(c)), calls.join(' | '))
  t.ok('видео шлёт подпись', /\/api\/video\?[^;]*&caption=/.test(src))
}
t.done()
