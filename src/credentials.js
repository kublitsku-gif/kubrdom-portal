// PINs are low entropy: an application secret (pepper) prevents an offline
// enumeration from a database export. Each record also has its own random salt.
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const bytes = s => new Uint8Array(s.match(/../g).map(x => parseInt(x,16)));
export function sameSecret(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
async function derive(pin, salt, pepper) {
  if (!pepper) throw new Error('Authentication secret is not configured');
  const hmac = await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const material = await crypto.subtle.sign('HMAC',hmac,enc.encode('kubr-pin:' + pin));
  const key = await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:100000},key,256));
}
export async function hashPin(pin, pepper) {
  if (!/^[0-9]{4,6}$/.test(pin)) throw new Error('PIN — 4–6 цифр');
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  return 'pbkdf2-sha256$100000$'+salt+'$'+await derive(pin,salt,pepper);
}
export async function checkPin(pin, record, pepper, client=false) {
  const hash=record[client?'clientPinHash':'pinHash'];
  if (hash) {
    const parts=String(hash).split('$');
    if(parts.length!==4 || parts[0]!=='pbkdf2-sha256' || parts[1]!=='100000' || !/^[0-9a-f]{32}$/.test(parts[2])) return false;
    return sameSecret(await derive(pin,parts[2],pepper),parts[3]);
  }
  // Transitional verification only for a PIN explicitly stored in the old row.
  // There is no default PIN or phone-derived credential.
  const legacy=record[client?'clientPin':'pin'];
  return typeof legacy==='string' && !!legacy && sameSecret(pin,legacy);
}
export function credentialVersion(record, client=false) {
  return String(record.authVersion || record[client?'clientPinHash':'pinHash'] || record[client?'clientPin':'pin'] || 'unset');
}
export async function protectCredentials(key, incoming, previous, pepper, mayReset=true) {
  if (!['users','contractDocs'].includes(key)) return incoming;
  const client=key==='contractDocs', raw=client?'clientPin':'pin', hash=client?'clientPinHash':'pinHash';
  const out=[];
  for(const row of incoming) {
    const old=(previous||[]).find(x=>x.id===row.id)||{};
    const next={...row};
    delete next.pinHash; delete next.clientPinHash; delete next.authVersion; delete next.hasPin;
    if(old[hash]) next[hash]=old[hash];
    if(old.authVersion) next.authVersion=old.authVersion;
    const requested=Object.prototype.hasOwnProperty.call(row,raw);
    if(requested && !mayReset) throw new Error('Нет права менять PIN');
    const value=requested?row[raw]:old[raw];
    delete next[raw];
    if(requested && value==='') { delete next[hash]; next.authVersion=crypto.randomUUID(); }
    else if(value) {
      next[hash]=await hashPin(String(value),pepper);
      next.authVersion=crypto.randomUUID();
    }
    out.push(next);
  }
  return out;
}
