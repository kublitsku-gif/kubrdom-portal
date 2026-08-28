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
      (w.mats || []).forEach(function (m) {
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
