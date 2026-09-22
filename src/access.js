import { STATE_SECTIONS, emptySection } from './state-schema.js';

export const DEFAULT_PERMISSIONS = {
  brigadier:['assign','finance'], worker:['assign','finance'], prod_head:['contracts'], supply:['supply','finance'],
  contract_mgr:[], client_mgr:['assign','contracts','crm','clients'], sales_head:['assign','finance','contracts','crm','marketing','works','kp','spec'],
  sales_mgr:['marketing','crm','works','kp','spec'], marketer:['marketing'], financier:['finance','crm'],
};
export function assignedObjects(user, contracts) {
  return [...new Set((user.objs || []).concat((contracts || []).filter(c => !c.archived && (c.responsible || []).includes(user.id)).map(c => c.objId)).filter(Boolean))];
}
export function permissionsFor(user, rolePermissions = {}) {
  return [...new Set((user.roles || []).flatMap(r => rolePermissions[r] || DEFAULT_PERMISSIONS[r] || []))];
}
export function accessFor(auth, state) {
  const roles = auth.user?.roles || [];
  const perms = auth.permissions || [];
  const has = (...p) => auth.adm || p.some(x => perms.includes(x));
  const field = !auth.adm && roles.some(r => ['brigadier','worker'].includes(r));
  const allObjects = !field && has('assign','contracts','clients','supply','finance','projects');
  const ids = new Set(allObjects || auth.adm ? (state.objects || []).map(o => o.id) : assignedObjects(auth.user || {}, state.contractDocs));
  const contracts = new Set((state.contractDocs || []).filter(c => auth.adm || (!field && has('contracts','clients','crm','finance')) || ids.has(c.objId) || (c.responsible || []).includes(auth.uid)).map(c => c.id));
  const materials = new Set((state.objects || []).filter(o => ids.has(o.id)).flatMap(o => (o.stages || []).flatMap(s => (s.works || []).flatMap(w => (w.mats || []).map(m => m.id)))));
  const managerFinance = auth.adm || roles.includes('financier');
  const read = key => {
    if (auth.adm) return true;
    if (['settings'].includes(key)) return false;
    if (['users','roles','rolePermissions','objects','contractDocs','issues'].includes(key)) return true;
    if (key.startsWith('fin')) return has('finance');
    if (key === 'crmClients') return has('crm','clients');
    if (['purchases','stock','purchased','arrived','receipts'].includes(key)) return has('assign','supply','finance');
    return has('works','kp','spec','projects','labels','assign','supply','contracts');
  };
  const write = key => {
    if (auth.adm) return true;
    if (['users','roles','rolePermissions','settings'].includes(key)) return false;
    if (key.startsWith('fin')) return managerFinance;
    if (key === 'objects') return has('assign','projects','spec','supply') || roles.includes('prod_head');
    if (key === 'contractDocs') return !field && has('contracts','clients','spec');
    if (key === 'crmClients') return has('crm','clients');
    if (key === 'issues') return has('issues','assign','clients','supply','contracts');
    if (key === 'receipts') return has('finance','supply','assign');
    if (key === 'arrived' || key === 'purchases') return has('supply','assign');
    if (key === 'purchased' || key === 'stock') return has('supply');
    if (['dbPlans'].includes(key)) return has('works','crm','clients','projects');
    if (['specSheets','specSheets2','projects'].includes(key)) return has('spec','projects','kp');
    return has('works') && !roles.every(r => ['sales_head','sales_mgr'].includes(r));
  };
  const visible = (key, record) => {
    if (auth.adm) return true;
    if (key === 'objects') return ids.has(record.id);
    if (key === 'contractDocs') return (!field && has('contracts','clients','crm','finance','spec')) || contracts.has(record.id);
    if (key === 'issues') return ids.has(record.objId) || record.by === auth.uid;
    if (key === 'purchases') return ids.has(record.objId);
    if (key === 'receipts') return managerFinance || record.userId === auth.uid;
    if (key === 'finTxns' && !managerFinance) return record.userId === auth.uid || (!record.userId && contracts.has(record.contractId) && /зарплат|доп.*работ|преми|штраф/i.test(record.category || ''));
    return true;
  };
  function project(key, data) {
    if (!read(key)) return emptySection(key);
    let out = Array.isArray(data) ? data.filter(r => visible(key, r)) : data;
    if (['purchased','arrived'].includes(key) && !auth.adm) out = Object.fromEntries(Object.entries(data || {}).filter(([id]) => materials.has(id)));
    if (['finSalaries','finContracts','finExtraWorks'].includes(key) && !managerFinance) out = Object.fromEntries(Object.entries(data || {}).filter(([id]) => ids.has(id)).map(([id, v]) => [id, key === 'finSalaries' ? {[auth.uid]:v[auth.uid] || {}} : v]));
    if (key === 'users') out = out.map(u => {
      const v = {...u,hasPin:!!(u.pinHash||u.pin)}; delete v.pin; delete v.pinHash; delete v.authVersion;
      if (!auth.adm && u.id !== auth.uid) { delete v.phone; delete v.dayNotes; delete v.daysOff; }
      return v;
    });
    if (key === 'contractDocs') out = out.map(c => {
      const v = {...c,hasPin:!!(c.clientPinHash||c.clientPin)}; delete v.clientPin; delete v.clientPinHash; delete v.authVersion;
      if (field) { delete v.files; delete v.docFile; delete v.passport; v.salaries = {[auth.uid]: c.salaries?.[auth.uid] || {}}; }
      return v;
    });
    return out;
  }
  function mergeWrite(key, incoming) {
    const old = state[key] || emptySection(key);
    if (!write(key)) throw new Error('Нет права изменять раздел «' + key + '»');
    if (auth.adm) return incoming;
    if (Array.isArray(incoming)) {
      for (const row of incoming) {
        const before = old.find(r => r.id === row.id);
        const canCreateObject = !before && !field && key === 'objects';
        if (!canCreateObject && !visible(key, before || row)) throw new Error('Нет доступа к записи «' + row.id + '»');
        if (!visible(key, row) && before && !['objects'].includes(key)) throw new Error('Нельзя перенести запись за пределы доступных объектов');
      }
      if (field && key === 'objects' && old.some(r => visible(key,r) && !incoming.some(x => x.id === r.id))) throw new Error('Удалять объекты может администратор');
      return old.filter(r => !visible(key,r)).concat(incoming);
    }
    if (['purchased','arrived'].includes(key)) {
      if (Object.keys(incoming).some(id => !materials.has(id))) throw new Error('Нет доступа к материалу');
      return {...Object.fromEntries(Object.entries(old).filter(([id]) => !materials.has(id))), ...incoming};
    }
    return incoming;
  }
  return {read, write, project, mergeWrite, ids, contracts, writable:STATE_SECTIONS.filter(write)};
}

export function routeAllowed(auth, path) {
  if (auth.adm) return true;
  if (auth.client) return /^\/api\/state\//.test(path) || path === '/api/client/accept-stage';
  const p = auth.permissions || [];
  if (/^\/api\/(ai|avito)\//.test(path)) return p.includes('crm') || p.includes('marketing');
  if (/^\/api\/voice/.test(path)) return p.includes('voiceai');
  if (['/api/photo-delete','/api/topic-rename','/api/notion/upload'].includes(path)) return false;
  if (path === '/api/plan-read') return ['works','spec','projects','kp'].some(x => p.includes(x));
  return true;
}
