#!/usr/bin/env node
// Планировки картинками в переписке с клиентом (src/plan-images.js + песочница в admin.js).
// ИИ называет ключи в "plans" — берём только известные; файл каждого ключа лежит в
// public/plans/ (его раздаёт портал, оттуда же его тянет Worker для Авито и Telegram).
import fs from 'node:fs'
import { boot, reporter } from './harness/panel-vm.js'
import { PLAN_IMAGES, MAX_PLANS, PLAN_INSTRUCTION, normPlans, planUrl, planTitles, avitoUploadForm, avitoImageId } from '../src/plan-images.js'

const t = reporter()

t.section('Каталог и файлы')
for (const [k, v] of Object.entries(PLAN_IMAGES)) {
  const f = 'public/plans/' + v.file
  t.ok(k + ' → ' + f + ' (JPEG)', fs.existsSync(f) && fs.readFileSync(f).subarray(0, 3).toString('hex') === 'ffd8ff')
}
t.ok('в инструкции модели перечислены все ключи', Object.keys(PLAN_IMAGES).every((k) => PLAN_INSTRUCTION.includes(k + ' (')))

t.section('Ответ модели → ключи')
t.ok('неизвестные и повторы выкинуты, регистр не важен', JSON.stringify(normPlans(['KD29-3', 'kd29-3', 'evil', 'house-all'])) === '["kd29-3","house-all"]')
t.ok('строка вместо массива тоже понимается', JSON.stringify(normPlans('banya-6')) === '["banya-6"]')
t.ok('мусор — пусто', normPlans(null).length === 0 && normPlans({ a: 1 }).length === 0 && normPlans('').length === 0)
t.ok('не больше ' + MAX_PLANS + ' картинок', normPlans(['kd29-1', 'kd29-2', 'kd29-3', 'kd29-4', 'kd29-5']).length === MAX_PLANS)
t.ok('адрес картинки — от базы портала', planUrl('https://portal.kubrdom.ru/', 'kd29-1') === 'https://portal.kubrdom.ru/plans/kd29-1.jpg' && planUrl('', 'banya-8') === 'https://portal.kubrdom.ru/plans/banya-8.jpg')
t.ok('подписи для черновика', planTitles(['kd29-2', 'banya-12']) === 'КД-29.2 — открытая студия; Баня 12 м: кухня-гостиная, туалет, душ, парная')

t.section('Авито: загрузка картинки')
const fd = avitoUploadForm(new Uint8Array([0xff, 0xd8, 0xff]), 'kd29-1.jpg')
const file = fd.get('uploadfile[]')
t.ok('поле uploadfile[] с JPEG', !!file && file.type === 'image/jpeg' && file.name === 'kd29-1.jpg' && file.size === 3)
t.ok('image_id из ответа uploadImages', avitoImageId({ '1234.abcd': { '1280x960': 'https://x/1.jpg' } }) === '1234.abcd')
t.ok('ошибка вместо id — пусто', avitoImageId({ error: { code: 413 } }) === '' && avitoImageId(null) === '' && avitoImageId([]) === '')

t.section('Песочница показывает картинку под ответом')
const p = boot({})
p.set({ settings: {}, crmClients: [], objects: [], templates: [], users: [] })
p.run('mktTest=[{role:"user",text:"Покажите планировки"},{role:"assistant",text:"Вот все пять.",needsApproval:false,plans:[{key:"house-all",title:"Все 5 планировок дома 40 футов",url:"/plans/kd29-all.jpg"}]}];mktTestBusy=false;')
const html = p.run('tMarketingMain()')
t.ok('картинка и подпись в ленте', html.indexOf('<img src="/plans/kd29-all.jpg"') >= 0 && html.indexOf('🖼 Все 5 планировок дома 40 футов') >= 0)
p.run('mktTest=[{role:"assistant",text:"Без картинки",needsApproval:false}];')
t.ok('нет plans — нет картинки', p.run('tMarketingMain()').indexOf('/plans/') < 0)

t.done()
