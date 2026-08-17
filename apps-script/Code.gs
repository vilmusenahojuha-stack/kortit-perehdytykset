const CONFIG = {
  usersSheet: "Käyttäjät",
  recordsSheet: "Kortit",
  // Vaihda nämä henkilökohtaisiksi PIN-koodeiksi ENNEN setupSystem-funktion suorittamista.
  initialUsers: [
    { name: "Juha", pin: "VAIHDA_JUHAN_PIN", role: "admin" },
    { name: "Matti", pin: "VAIHDA_MATIN_PIN", role: "user" },
    { name: "Janne", pin: "VAIHDA_JANNEN_PIN", role: "user" },
    { name: "Tommi", pin: "VAIHDA_TOMMIN_PIN", role: "user" }
  ]
};

const USER_HEADERS = ["name", "pinHash", "role", "active"];
const RECORD_HEADERS = ["id", "user", "type", "name", "completedDay", "completedMonth", "completedYear", "expiresDay", "expiresMonth", "expiresYear", "notes", "updatedAt", "updatedBy"];

function setupSystem() {
  const ss = SpreadsheetApp.getActive();
  const users = getOrCreateSheet_(ss, CONFIG.usersSheet, USER_HEADERS);
  getOrCreateSheet_(ss, CONFIG.recordsSheet, RECORD_HEADERS);
  if (users.getLastRow() > 1) throw new Error("Käyttäjät-välilehdellä on jo tietoja. Asennusta ei tehty uudelleen.");
  const invalid = CONFIG.initialUsers.some(u => !/^\d{4,12}$/.test(String(u.pin)));
  if (invalid) throw new Error("Vaihda kaikki VAIHDA_...-PIN-arvot 4–12-numeroisiksi ennen asennusta.");
  const uniquePins = new Set(CONFIG.initialUsers.map(u => String(u.pin)));
  if (uniquePins.size !== CONFIG.initialUsers.length) throw new Error("Jokaisella käyttäjällä täytyy olla eri PIN-koodi.");
  const rows = CONFIG.initialUsers.map(u => [u.name, hashPin_(u.pin), u.role, true]);
  users.getRange(2, 1, rows.length, USER_HEADERS.length).setValues(rows);
  users.autoResizeColumns(1, USER_HEADERS.length);
  SpreadsheetApp.getActive().toast("Kortit ja perehdytykset: asennus valmis.");
}

function doGet() { return json_({ ok: true, service: "kortit-perehdytykset", version: 2 }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const input = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(input.action || "");
    if (!action) throw new Error("Toiminto puuttuu.");
    if (action === "workLogin") {
      const workActor = authenticate_(input.pin);
      if (workActor.name !== String(input.user || "").trim()) throw new Error("PIN ei kuulu valitulle käyttäjälle.");
      return json_({ ok: true, user: publicUser_(workActor), token: createWorkToken_(workActor.name), status: statusSummaryByUser_(workActor.name) });
    }
    if (action === "workStatus") {
      const tokenUser = verifyWorkToken_(input.token);
      return json_({ ok: true, user: tokenUser, status: statusSummaryByUser_(tokenUser) });
    }
    const actor = authenticateRequest_(input);
    if (action === "login") return json_({ ok: true, user: publicUser_(actor), users: actor.role === "admin" ? listUsers_() : [] });
    if (action === "listMine") return json_({ ok: true, records: listRecords_().filter(r => r.user === actor.name) });
    if (action === "listAll") { requireAdmin_(actor); return json_({ ok: true, records: listRecords_(), users: listUsers_() }); }
    lock.waitLock(10000);
    if (action === "saveRecord") return json_({ ok: true, record: saveRecord_(actor, input.record || {}) });
    if (action === "deleteRecord") return json_({ ok: true, deleted: deleteRecord_(actor, input.id) });
    throw new Error("Tuntematon toiminto.");
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function statusSummaryByUser_(userName) {
  const user = String(userName || "").trim();
  if (!user || !listUsers_().some(u => u.name === user)) throw new Error("Työntekijää ei löytynyt.");
  const counts = { valid: 0, warning: 0, expired: 0, total: 0 };
  listRecords_().filter(r => r.user === user).forEach(r => { counts[recordStatus_(r)]++; counts.total++; });
  return counts;
}
function recordStatus_(record) {
  const today = startOfDay_(new Date()), expires = recordExpiryDate_(record);
  if (today.getTime() > expires.getTime()) return "expired";
  return today.getTime() >= recordWarningDate_(record).getTime() ? "warning" : "valid";
}
function recordExpiryDate_(record) {
  const year = Number(record.expiresYear), month = Number(record.expiresMonth);
  const day = Number(record.expiresDay) || new Date(year, month, 0).getDate();
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}
function recordWarningDate_(record) {
  const months = record.type === "orientation" ? 1 : 2;
  if (!record.expiresDay) return new Date(Number(record.expiresYear), Number(record.expiresMonth) - 1 - months, 1);
  const expires = recordExpiryDate_(record), first = new Date(expires.getFullYear(), expires.getMonth() - months, 1);
  const day = Math.min(expires.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate());
  return new Date(first.getFullYear(), first.getMonth(), day);
}
function startOfDay_(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function createWorkToken_(userName) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ user: userName, expires: Date.now() + 18 * 60 * 60 * 1000 })).replace(/=+$/, "");
  return payload + "." + signWorkToken_(payload);
}
function verifyWorkToken_(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || parts[1] !== signWorkToken_(parts[0])) throw new Error("Työaikaistunto ei kelpaa.");
  let data;
  try { data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (_) { throw new Error("Työaikaistunto ei kelpaa."); }
  if (!data.user || Number(data.expires) < Date.now()) throw new Error("Työaikaistunto on vanhentunut.");
  if (!listUsers_().some(u => u.name === data.user)) throw new Error("Työntekijää ei löytynyt.");
  return String(data.user);
}
function signWorkToken_(payload) {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty("WORK_TOKEN_SECRET");
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); properties.setProperty("WORK_TOKEN_SECRET", secret); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret)).replace(/=+$/, "");
}

function authenticateRequest_(input) {
  if (input && input.workToken) {
    const userName = verifyWorkToken_(input.workToken);
    const user = listUsers_().find(u => u.name === userName);
    if (!user) throw new Error("Työntekijää ei löytynyt.");
    return publicUser_(user);
  }
  return authenticate_(input && input.pin);
}

function authenticate_(pin) {
  const value = String(pin || "");
  if (!/^\d{4,12}$/.test(value)) throw new Error("Väärä PIN-koodi.");
  const hash = hashPin_(value);
  const user = readObjects_(getSheet_(CONFIG.usersSheet)).find(u => String(u.pinHash) === hash && truthy_(u.active));
  if (!user) throw new Error("Väärä PIN-koodi.");
  return publicUser_(user);
}

function listUsers_() { return readObjects_(getSheet_(CONFIG.usersSheet)).filter(u => truthy_(u.active)).map(publicUser_); }
function publicUser_(u) { return { name: String(u.name || ""), role: String(u.role || "user"), active: truthy_(u.active) }; }
function requireAdmin_(actor) { if (actor.role !== "admin") throw new Error("Ei ylläpitäjän oikeutta."); }
function listRecords_() { return readObjects_(getSheet_(CONFIG.recordsSheet)).map(normalizeRecord_); }

function saveRecord_(actor, source) {
  const record = normalizeRecord_(source);
  record.user = actor.role === "admin" ? String(source.user || "").trim() : actor.name;
  if (!listUsers_().some(u => u.name === record.user)) throw new Error("Työntekijää ei löytynyt.");
  validateRecord_(record);
  const sheet = getSheet_(CONFIG.recordsSheet);
  const rows = readObjects_(sheet);
  const existingIndex = record.id ? rows.findIndex(r => String(r.id) === record.id) : -1;
  if (existingIndex >= 0) {
    const old = normalizeRecord_(rows[existingIndex]);
    if (actor.role !== "admin" && old.user !== actor.name) throw new Error("Et voi muokata toisen tietoja.");
  } else record.id = Utilities.getUuid();
  record.updatedAt = new Date().toISOString(); record.updatedBy = actor.name;
  const values = RECORD_HEADERS.map(h => record[h] === undefined ? "" : record[h]);
  const rowNumber = existingIndex >= 0 ? existingIndex + 2 : sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  return record;
}

function deleteRecord_(actor, id) {
  const value = String(id || ""); if (!value) throw new Error("Tunniste puuttuu.");
  const sheet = getSheet_(CONFIG.recordsSheet); const rows = readObjects_(sheet); const index = rows.findIndex(r => String(r.id) === value);
  if (index < 0) throw new Error("Merkintää ei löytynyt.");
  if (actor.role !== "admin" && String(rows[index].user) !== actor.name) throw new Error("Et voi poistaa toisen tietoja.");
  sheet.deleteRow(index + 2); return value;
}

function normalizeRecord_(r) {
  return { id:String(r.id||""), user:String(r.user||""), type:String(r.type||"card"), name:String(r.name||""), completedDay:r.completedDay===""?"":Number(r.completedDay||0), completedMonth:Number(r.completedMonth||0), completedYear:Number(r.completedYear||0), expiresDay:r.expiresDay===""?"":Number(r.expiresDay||0), expiresMonth:Number(r.expiresMonth||0), expiresYear:Number(r.expiresYear||0), notes:String(r.notes||""), updatedAt:String(r.updatedAt||""), updatedBy:String(r.updatedBy||"") };
}

function validateRecord_(r) {
  if (!["card","orientation"].includes(r.type)) throw new Error("Tyyppi ei kelpaa.");
  if (!r.name || r.name.length > 100) throw new Error("Anna nimi (enintään 100 merkkiä).");
  validateDate_(r.completedDay, r.completedMonth, r.completedYear, "Suoritettu");
  validateDate_(r.expiresDay, r.expiresMonth, r.expiresYear, "Vanhenee");
  if (r.notes.length > 500) throw new Error("Lisätiedot ovat liian pitkät.");
}

function validateDate_(day, month, year, label) {
  const d = day === "" ? 0 : Number(day), m = Number(month), y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2199) throw new Error(label + ": tarkista kuukausi ja vuosi.");
  if (d) { const max = new Date(y, m, 0).getDate(); if (!Number.isInteger(d) || d < 1 || d > max) throw new Error(label + ": päivä ei kelpaa."); }
}

function hashPin_(pin) {
  const salt = getSalt_();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + String(pin), Utilities.Charset.UTF_8);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}
function getSalt_() { const p=PropertiesService.getScriptProperties(); let s=p.getProperty("PIN_SALT"); if(!s){s=Utilities.getUuid()+Utilities.getUuid();p.setProperty("PIN_SALT",s);} return s; }
function truthy_(v) { return v === true || String(v).toLowerCase() === "true" || String(v) === "1"; }
function getSheet_(name) { const s=SpreadsheetApp.getActive().getSheetByName(name); if(!s) throw new Error("Suorita ensin setupSystem Apps Scriptissä."); return s; }
function getOrCreateSheet_(ss, name, headers) { let s=ss.getSheetByName(name); if(!s)s=ss.insertSheet(name); if(s.getLastRow()===0)s.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold").setBackground("#dbe8ff"); s.setFrozenRows(1); return s; }
function readObjects_(sheet) { const values=sheet.getDataRange().getValues(); if(values.length<2)return[]; const headers=values[0].map(String); return values.slice(1).filter(r=>r.some(v=>v!=="")).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]]))); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
