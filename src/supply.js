// ─── ЗАКУПКИ: ПОТРЕБНОСТЬ РАБОТЫ ≠ ПАРТИЯ ЗАКУПКИ ────────────────────────────
// Раньше закупка была флажком на копии материала: purchased[matId] = true. Отсюда три
// беды: нельзя купить частично (нужно 100 м, привезли 60), одна покупка на пять работ
// не выражается вовсе, и себестоимость не собрать — цены нет, есть только «галочка».
//
// Модель:
//   ПОТРЕБНОСТЬ — это mats внутри работы: что и сколько нужно (как было).
//   ПАРТИЯ      — запись о покупке: дата, магазин, чек, позиции с ценой и количеством.
//                 Позиция партии ссылается на потребность (needId = id материала работы),
//                 поэтому одна партия закрывает потребности сразу нескольких работ.
//   ПРИЁМКА     — на позиции партии: сколько реально доехало до объекта.
//
// Совместимость: пока партий нет, статусы считаются по старым purchased/arrived, и портал
// ведёт себя ровно как прежде. Это позволяет катить этапами, ничего не ломая.

// purchases: [{ id, date, store, objId, by, note, txnId, items:[{ id, needId, name, qty, price, gotQty, gotAt, gotBy }] }]

export function needQty(m) {
  const q = Number(m && m.qty);
  return isFinite(q) && q > 0 ? q : 1;
}

// Сколько по этой потребности куплено и сколько принято — из партий; при их отсутствии
// падаем на старые флаги (куплено/принято = вся потребность целиком).
export function needStatus(matId, need, purchases, legacyPurchased, legacyArrived) {
  const want = needQty(need);
  let bought = 0, got = 0, spent = 0, hasBatch = false;
  (purchases || []).forEach(function (p) {
    (p.items || []).forEach(function (it) {
      if (it.needId !== matId) return;
      hasBatch = true;
      const q = Number(it.qty) || 0;
      bought += q;
      got += Number(it.gotQty) || 0;
      spent += q * (Number(it.price) || 0);
    });
  });
  if (!hasBatch) {
    const b = !!(legacyPurchased || {})[matId], a = !!(legacyArrived || {})[matId];
    return { want: want, bought: b ? want : 0, got: a ? want : 0, spent: b ? want * (Number(need && need.cost) || 0) : 0, legacy: true };
  }
  return { want: want, bought: bought, got: got, spent: spent, legacy: false };
}

// Состояния по возрастанию готовности. Частичную ПРИЁМКУ отличаем отдельно: для бригадира
// «привезли 25 из 50» — это совсем не то же самое, что «всё куплено и едет».
export const needState = (s) =>
  s.got >= s.want ? "got"
  : s.got > 0 ? "partialGot"
  : s.bought >= s.want ? "bought"
  : s.bought > 0 ? "partial"
  : "none";

// Сводка по объекту: сколько позиций в каком состоянии и сколько денег потрачено.
export function objectSupply(obj, purchases, legacyPurchased, legacyArrived) {
  const out = { need: 0, none: 0, partial: 0, bought: 0, got: 0, spent: 0, needSum: 0 };
  (obj.stages || []).forEach(function (s) {
    (s.works || []).forEach(function (w) {
      buyMats(w).forEach(function (m) {
        const st = needStatus(m.id, m, purchases, legacyPurchased, legacyArrived);
        const state = needState(st);
        out.need++;
        out[state === "got" ? "got" : state === "partialGot" || state === "bought" ? "bought" : state === "partial" ? "partial" : "none"]++;
        out.spent += st.spent;
        if (state === "none" || state === "partial") out.needSum += (st.want - st.bought) * (Number(m.cost) || 0);
      });
    });
  });
  return out;
}

// ─── Миграция ────────────────────────────────────────────────────────────────
// Старые флаги превращаем в одну «историческую» партию на объект: что было отмечено
// купленным — попадает в неё с ценой из карточки материала, отмеченное принятым —
// с проставленным gotQty. Никакие данные не выбрасываем, статусы сохраняются один в один.
export function migrateLegacy(objects, legacyPurchased, legacyArrived, stamp) {
  const purchases = [];
  (objects || []).forEach(function (o) {
    const items = [];
    (o.stages || []).forEach(function (s) {
      (s.works || []).forEach(function (w) {
        (w.mats || []).forEach(function (m) {
          const wasBought = !!(legacyPurchased || {})[m.id];
          const wasGot = !!(legacyArrived || {})[m.id];
          // В данных есть позиции, отмеченные принятыми БЕЗ отметки «куплено» — если брать
          // только купленные, при переносе они исчезнут вместе со своей приёмкой.
          // Принято на объекте — значит куплено, иначе оно там взяться не могло.
          if (!wasBought && !wasGot) return;
          const q = needQty(m);
          items.push({
            id: "pi_" + m.id, needId: m.id, name: m.n || "", qty: q,
            price: Number(m.cost) || 0,
            gotQty: wasGot ? q : 0,
            gotAt: wasGot ? stamp : null,
            noteLegacy: !wasBought && wasGot ? "было отмечено принятым без отметки закупки" : undefined,
          });
        });
      });
    });
    if (items.length) {
      purchases.push({
        id: "pur_hist_" + o.id, date: stamp, store: "", objId: o.id, by: "",
        note: "перенос отметок закупки (историческая партия)", items: items,
      });
    }
  });
  return purchases;
}

// ─── ПОЗИЦИИ «ВЫБОР КЛИЕНТА» ─────────────────────────────────────────────────
// m.sel — материал, который выбирает клиент (плитка, печь, двери, сантехника), а сумма
// в смете служит бюджетом выбора. m.selDue — до какого числа выбрать, m.selDone — дата,
// когда выбор состоялся. Общий предикат: панель рисует по нему плашки, крон — напоминания,
// и «просрочен» на экране совпадает с «просрочен» в чате.
export function isSelection(m) { return !!(m && m.sel); }
export function selectionPending(m) { return isSelection(m) && !m.selDone; }
export function pendingSelections(objects, today) {
  const out = [];
  (objects || []).forEach(function (o) {
    ((o && o.stages) || []).forEach(function (s) {
      ((s.works) || []).forEach(function (w) {
        ((w.mats) || []).forEach(function (m) {
          if (!selectionPending(m)) return;
          const due = m.selDue || "";
          out.push({ obj: o, stage: s, work: w, mat: m, due: due, overdue: !!(due && today > due) });
        });
      });
    });
  });
  // Сначала просроченные, потом по сроку: список читают сверху и до первого «ну это потом».
  out.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return String(a.due || "9999").localeCompare(String(b.due || "9999"));
  });
  return out;
}

// ─── ЗАКУПАЕТ ЗАКАЗЧИК ───────────────────────────────────────────────────────
// `m.client` — позицию покупает заказчик сам, мы даём объём и ссылку. Это не наши
// деньги: такая строка не должна висеть в «осталось купить», портить прогресс
// закупки и подытог этапа — иначе снабженец каждый день видит долг, который ему
// нечем закрыть, а процент готовности врёт про чужие покупки.
//
// Признак живёт НА МАТЕРИАЛЕ, а не отдельной картой по id: он переживает правку
// строки и уезжает вместе с материалом, куда бы его ни перенесли. Приёмку на
// склад он при этом НЕ отменяет — материал всё равно физически приезжает на
// объект, и бригадир отмечает его как обычно.
export function clientBuys(m) { return !!(m && m.client); }

// Что уходит в передачу заказчику: постоянно помеченные плюс добранные разово
// (`picked` — карта id, живёт на экране и в снимок не пишется). Одна функция на
// экран, счётчик и PDF: разойдись они, в списке окажется не то, что показано.
export function handoffMats(mats, picked) {
  const pick = picked || {};
  return (mats || []).filter(function (m) { return m && (clientBuys(m) || !!pick[m.id]); });
}

// Сумма и счёт передачи. Считаем той же формулой, что и вся закупка (цена × кол-во),
// иначе цифра в плашке разойдётся с итогом в PDF.
export function handoffTotals(list) {
  const rows = list || [];
  return {
    count: rows.length,
    sum: rows.reduce(function (a, m) { return a + (Number(m && m.cost) || 0) * ((m && m.qty) || 1); }, 0),
  };
}

// Наша половина закупки — всё, кроме того, что берёт на себя заказчик. По ней
// считаются прогресс, «куплено / осталось» и подытоги этапов.
export function ourMats(mats) {
  return (mats || []).filter(function (m) { return !clientBuys(m); });
}

// ─── ТРУД — НЕ ТОВАР ─────────────────────────────────────────────────────────
// У своей работы «материал» — это она сама: её имя и цена показаны одним
// материалом с флагом `own`, чтобы деньги считались общим правилом. Купить его
// нельзя: это оплата труда, а не позиция в магазине. Снабжение обязано его
// пропускать — иначе «Сборка стеллажей» висит в списке закупки, ждёт приёмки на
// склад и портит «осталось купить» суммой, которую никто не понесёт в кассу.
//
// Связь материала с работой при этом никуда не девается: у каждой строки закупки
// есть своя работа (`↳ имя`), и убираем мы только псевдо-материал самой работы.
export function isLabour(m) { return !!(m && m.own); }

// Что из работы реально закупается.
export function buyMats(w) {
  return (((w && w.mats) || [])).filter(function (m) { return !isLabour(m); });
}

// Похоже на работу, а не на покупку. Нужно ТОЛЬКО для подсказки: объекты, собранные
// до появления флага `own`, его не несут, и вручную помечать полсотни строк никто не
// будет. Схлопывать автоматически нельзя — ошибка здесь прячет из закупки настоящий
// материал, а это отказ хуже исходного. Поэтому предлагаем, решает человек.
//
// Признаки собраны так, чтобы товар под них не попадал: у своей работы нет карточки
// каталога, количество всегда одно, а имя строки совпадает с именем самой работы —
// потому что «материал» у неё это она сама.
export function looksLikeLabour(m) {
  if (!m || isLabour(m)) return false;
  const n = String(m.n || "").trim();
  if (!n || m.pid) return false;
  if ((Number(m.qty) || 1) !== 1) return false;
  return String(m.wn || "").trim() === n;
}
