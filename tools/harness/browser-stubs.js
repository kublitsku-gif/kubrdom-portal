// Заглушки браузера для запуска public/admin.js в node:vm.
//
// admin.js — не модуль: он объявляет всё в глобальной области и на верхнем
// уровне вешает слушатели (`window.addEventListener("pagehide", …)`). Поэтому
// достаточно контекста, в котором эти вызовы не падают: рендер-функции
// (tObjects, tSupplySelect, tReceive) чистые — возвращают HTML-строку и DOM
// не трогают, так что честного DOM не нужно.
import vm from 'node:vm'

// Элемент-«всёпринимающий»: любой неизвестный метод молча возвращает пустую
// строку, любое свойство — читается. Хватает для кода, который в момент
// загрузки трогает узлы, но результат не проверяет.
function stubElement() {
  const base = {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    querySelector: () => stubElement(), querySelectorAll: () => [],
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  }
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? '' : undefined),
    set: (t, k, v) => { t[k] = v; return true },
  })
}

function stubDocument() {
  return {
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    createElement: () => stubElement(),
    createTextNode: () => stubElement(),
    addEventListener() {}, removeEventListener() {},
    body: stubElement(), head: stubElement(), documentElement: stubElement(),
    cookie: '', readyState: 'complete', activeElement: null,
  }
}

// Возвращает готовый vm-контекст. `window`, `globalThis` и `self` указывают на
// сам контекст — admin.js обращается ко всем трём.
export function createBrowserContext() {
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, RegExp,
    Error, TypeError, Map, Set, WeakMap, Promise, Symbol, Intl,
    isNaN, isFinite, parseFloat, parseInt,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    // Таймеры и сеть — no-op: автосейв и поллер не должны стучаться наружу.
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    fetch: () => new Promise(() => {}),
    document: stubDocument(),
    navigator: { userAgent: 'node-harness', clipboard: { writeText: () => Promise.resolve() }, language: 'ru' },
    location: { href: 'https://portal.kubrdom.ru/admin', search: '', hash: '', pathname: '/admin', origin: 'https://portal.kubrdom.ru' },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    crypto: { randomUUID: () => 'harness-uuid', getRandomValues: (a) => a },
    alert() {}, confirm: () => false, prompt: () => null,
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    // Без этого admin.js падает на верхнем уровне: строка с "pagehide".
    addEventListener() {}, removeEventListener() {},
    scrollTo() {}, open: () => null, print() {},
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
  }
  ctx.window = ctx
  ctx.globalThis = ctx
  ctx.self = ctx
  ctx.top = ctx
  ctx.parent = ctx
  return vm.createContext(ctx)
}
