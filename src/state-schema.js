// Wire contract shared by the API and panel. Unknown fields inside records remain
// compatible with older domain modules; section types and identities are strict.
export const MAP_SECTIONS = ['estRooms','rolePermissions','purchased','arrived','finSalaries','finContracts','finExtraWorks','settings'];
export const ARRAY_SECTIONS = ['objects','templates','estimates','estStages','estKinds','users','roles','dbWorks','expProducts','dbPlans','purchases','stock','specSheets','specSheets2','buildRules','projects','winTypes','finTxns','receipts','contractDocs','crmClients','issues'];
export const STATE_SECTIONS = ARRAY_SECTIONS.concat(MAP_SECTIONS);
export const MAX_SECTION_BYTES = 1900000;
export const MAX_STATE_BYTES = 12 * 1024 * 1024;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function emptySection(key) { return MAP_SECTIONS.includes(key) ? {} : []; }
export function validateStateItems(items) {
  if (!Array.isArray(items) || items.length > STATE_SECTIONS.length) return 'Неверный список разделов';
  const seen = new Set();
  function walk(value, depth) {
    if (depth > 30) return 'Слишком большая вложенность данных';
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      const ids = new Set();
      for (const item of value) {
        if (plain(item) && item.id != null) {
          if (typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id)) return 'Повторный или неверный идентификатор';
          ids.add(item.id);
        }
        const error = walk(item, depth + 1); if (error) return error;
      }
    } else {
      for (const key of Object.keys(value)) {
        if (['__proto__','prototype','constructor'].includes(key)) return 'Недопустимое поле';
        const error = walk(value[key], depth + 1); if (error) return error;
      }
    }
    return '';
  }
  for (const item of items) {
    if (!plain(item) || !STATE_SECTIONS.includes(item.work_id) || seen.has(item.work_id)) return 'Неизвестный или повторный раздел';
    seen.add(item.work_id);
    if (MAP_SECTIONS.includes(item.work_id) ? !plain(item.data) : !Array.isArray(item.data)) return 'Неверный тип раздела «' + item.work_id + '»';
    if (Array.isArray(item.data)) {
      const identity=item.work_id==='estStages'?'n':item.work_id==='estKinds'?'k':'id';
      const ids=new Set();
      for(const v of item.data) {
        if(!plain(v) || !['string','number'].includes(typeof v[identity]) || String(v[identity])==='' || ids.has(String(v[identity]))) return 'Неверный или повторный '+identity+' в разделе «'+item.work_id+'»';
        ids.add(String(v[identity]));
      }
    }
    const error = walk(item.data, 0); if (error) return item.work_id + ': ' + error;
    if (new TextEncoder().encode(JSON.stringify(item.data)).length > MAX_SECTION_BYTES) return 'Раздел «' + item.work_id + '» слишком большой';
    if (item.work_id === 'users' && !item.data.some(u => Array.isArray(u.roles) && u.roles.includes('admin'))) return 'Нельзя удалить последнего администратора';
    if (item.work_id === 'users' && item.data.some(u => !Array.isArray(u.roles) || !u.roles.every(r => typeof r === 'string'))) return 'Неверные роли сотрудника';
  }
  return '';
}
