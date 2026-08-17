(() => {
  "use strict";

  // Lisää uuden Apps Script -julkaisun /exec-osoite tähän käyttöönoton lopussa.
  const API_URL = "https://script.google.com/macros/s/AKfycbws1ods-A_0YnJ04cWHU8D5bTdGVg8Z36qA6lsuyEUHYuDlneG_KkOd32ZP8tK1-4Vc/exec";
  const STORAGE_KEY = "kp_api_url_v1";

  const $ = (id) => document.getElementById(id);
  const state = { pin: "", workToken: "", user: null, users: [], records: [], typeFilter: "all", statusFilter: "all", editingId: "" };

  const apiUrl = () => (API_URL || localStorage.getItem(STORAGE_KEY) || "").trim();
  const pad2 = (n) => String(n).padStart(2, "0");
  const monthLabel = (m, y) => `${pad2(m)}/${String(y).slice(-2)}`;
  const fullDateLabel = (d, m, y) => d ? `${pad2(d)}.${pad2(m)}.${y}` : monthLabel(m, y);
  const lastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();

  function expiryDate(record) {
    const y = Number(record.expiresYear);
    const m = Number(record.expiresMonth);
    const d = Number(record.expiresDay) || lastDayOfMonth(y, m);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }

  function warningDate(record) {
    const months = record.type === "orientation" ? 1 : 2;
    if (!record.expiresDay) return new Date(Number(record.expiresYear), Number(record.expiresMonth) - 1 - months, 1);
    const exp = expiryDate(record);
    const targetMonth = exp.getMonth() - months;
    const first = new Date(exp.getFullYear(), targetMonth, 1);
    const day = Math.min(exp.getDate(), lastDayOfMonth(first.getFullYear(), first.getMonth() + 1));
    return new Date(first.getFullYear(), first.getMonth(), day);
  }

  function statusOf(record, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (today > expiryDate(record)) return "expired";
    if (today >= warningDate(record)) return "warning";
    return "valid";
  }

  function validateDateParts(day, month, year, label) {
    const d = day === "" ? 0 : Number(day), m = Number(month), y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2199) return `${label}: tarkista kuukausi ja vuosi.`;
    if (d && (!Number.isInteger(d) || d < 1 || d > lastDayOfMonth(y, m))) return `${label}: päivä ei kelpaa valittuun kuukauteen.`;
    return "";
  }

  async function api(action, data = {}) {
    const url = apiUrl();
    if (!url) throw new Error("Apps Script -osoite puuttuu.");
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, pin: state.pin, workToken: state.workToken, ...data }) });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("Palvelimen vastaus ei kelpaa."); }
    if (!response.ok || !json.ok) throw new Error(json.error || "Toiminto epäonnistui.");
    return json;
  }

  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function setBusy(button, busy) { button.disabled = busy; }

  async function login() {
    const pin = $("pinInput").value.trim();
    if (!pin) return $("loginMessage").textContent = "Syötä PIN-koodi.";
    state.pin = pin; state.workToken = ""; setBusy($("loginBtn"), true); $("loginMessage").textContent = "";
    try {
      const result = await api("login");
      state.user = result.user; state.users = result.users || [];
      sessionStorage.setItem("kp_pin", pin);
      await loadRecords();
      showApp();
    } catch (error) {
      state.pin = ""; $("loginMessage").textContent = error.message;
    } finally { setBusy($("loginBtn"), false); }
  }

  async function loadRecords() {
    const result = await api(state.user?.role === "admin" ? "listAll" : "listMine");
    state.records = result.records || [];
    if (result.users) state.users = result.users;
  }

  function showApp() {
    $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
    $("subtitle").textContent = state.user.role === "admin" ? `${state.user.name} – ylläpitäjä` : state.user.name;
    $("adminTools").classList.toggle("hidden", state.user.role !== "admin");
    $("ownerField").classList.toggle("hidden", state.user.role !== "admin");
    fillUsers(); render();
  }

  function logout() {
    state.pin = ""; state.workToken = ""; state.user = null; state.records = []; sessionStorage.removeItem("kp_pin"); sessionStorage.removeItem("kp_work_token");
    $("pinInput").value = ""; $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden"); $("logoutBtn").classList.add("hidden"); $("subtitle").textContent = "Kirjaudu PIN-koodilla";
  }

  function fillUsers() {
    const active = state.users.filter((u) => u.active !== false);
    $("userFilter").innerHTML = `<option value="all">Kaikki työntekijät</option>` + active.map((u) => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join("");
    $("ownerInput").innerHTML = active.map((u) => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join("");
  }

  function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value ?? ""; return div.innerHTML; }

  function visibleRecords() {
    const user = $("userFilter")?.value || "all";
    return state.records.filter((r) => (state.user.role !== "admin" || user === "all" || r.user === user) && (state.typeFilter === "all" || r.type === state.typeFilter) && (state.statusFilter === "all" || statusOf(r) === state.statusFilter));
  }

  function render() {
    const base = state.records.filter((r) => state.user.role !== "admin" || ($("userFilter").value || "all") === "all" || r.user === $("userFilter").value);
    const counts = { valid: 0, warning: 0, expired: 0 };
    base.forEach((r) => counts[statusOf(r)]++);
    $("validCount").textContent = counts.valid; $("warningCount").textContent = counts.warning; $("expiredCount").textContent = counts.expired;
    const records = visibleRecords().sort((a, b) => expiryDate(a) - expiryDate(b));
    $("listHint").textContent = records.length ? `${records.length} merkintää` : "Ei merkintöjä tällä rajauksella.";
    $("recordList").innerHTML = records.map((r) => {
      const status = statusOf(r); const statusText = status === "valid" ? "Voimassa" : status === "warning" ? "Vanhenee pian" : "Vanhentunut";
      const performed = fullDateLabel(Number(r.completedDay) || 0, r.completedMonth, r.completedYear);
      const expires = fullDateLabel(Number(r.expiresDay) || 0, r.expiresMonth, r.expiresYear);
      return `<button class="record ${status}" data-id="${escapeHtml(r.id)}" type="button"><span class="status-bar"></span><span><span class="record-title">${escapeHtml(r.name)}</span><span class="record-meta">${r.type === "card" ? "Kortti" : "Perehdytys"}${state.user.role === "admin" ? ` · ${escapeHtml(r.user)}` : ""}<br>Suoritettu ${performed} · Vanhenee ${expires}</span></span><span class="badge">${statusText}</span></button>`;
    }).join("");
  }

  function openEditor(record = null) {
    state.editingId = record?.id || ""; $("dialogTitle").textContent = record ? "Muokkaa merkintää" : "Lisää uusi"; $("deleteBtn").classList.toggle("hidden", !record);
    $("ownerInput").value = record?.user || (state.user.role === "admin" ? (($("userFilter").value !== "all" && $("userFilter").value) || state.user.name) : state.user.name);
    $("typeInput").value = record?.type || "card"; $("nameInput").value = record?.name || "";
    ["completedDay","completedMonth","completedYear","expiresDay","expiresMonth","expiresYear"].forEach((id) => $(id).value = record?.[id] || "");
    $("notesInput").value = record?.notes || ""; $("formMessage").textContent = ""; $("editDialog").showModal();
  }

  function closeEditor() { $("editDialog").close(); state.editingId = ""; }

  async function saveRecord(event) {
    event.preventDefault();
    const completedError = validateDateParts($("completedDay").value, $("completedMonth").value, $("completedYear").value, "Suoritettu");
    const expiresError = validateDateParts($("expiresDay").value, $("expiresMonth").value, $("expiresYear").value, "Vanhenee");
    if (completedError || expiresError) return $("formMessage").textContent = completedError || expiresError;
    const record = { id: state.editingId, user: state.user.role === "admin" ? $("ownerInput").value : state.user.name, type: $("typeInput").value, name: $("nameInput").value.trim(), completedDay: $("completedDay").value, completedMonth: Number($("completedMonth").value), completedYear: Number($("completedYear").value), expiresDay: $("expiresDay").value, expiresMonth: Number($("expiresMonth").value), expiresYear: Number($("expiresYear").value), notes: $("notesInput").value.trim() };
    setBusy($("saveBtn"), true);
    try { await api("saveRecord", { record }); await loadRecords(); closeEditor(); render(); toast("Tallennettu ✔"); }
    catch (error) { $("formMessage").textContent = error.message; }
    finally { setBusy($("saveBtn"), false); }
  }

  async function deleteRecord() {
    if (!state.editingId || !confirm("Poistetaanko tämä merkintä varmasti?")) return;
    setBusy($("deleteBtn"), true);
    try { await api("deleteRecord", { id: state.editingId }); await loadRecords(); closeEditor(); render(); toast("Poistettu"); }
    catch (error) { $("formMessage").textContent = error.message; }
    finally { setBusy($("deleteBtn"), false); }
  }

  function bind() {
    $("loginBtn").addEventListener("click", login); $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); }); $("logoutBtn").addEventListener("click", logout);
    $("addBtn").addEventListener("click", () => openEditor()); $("closeDialogBtn").addEventListener("click", closeEditor); $("cancelBtn").addEventListener("click", closeEditor); $("editForm").addEventListener("submit", saveRecord); $("deleteBtn").addEventListener("click", deleteRecord);
    $("recordList").addEventListener("click", (e) => { const button = e.target.closest("[data-id]"); if (button) openEditor(state.records.find((r) => r.id === button.dataset.id)); });
    $("userFilter").addEventListener("change", render);
    document.querySelectorAll("[data-type-filter]").forEach((b) => b.addEventListener("click", () => { state.typeFilter = b.dataset.typeFilter; document.querySelectorAll("[data-type-filter]").forEach((x) => x.classList.toggle("active", x === b)); render(); }));
    document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.statusFilter = state.statusFilter === b.dataset.filter ? "all" : b.dataset.filter; render(); }));
  }

  async function restoreSession() {
    if (!apiUrl()) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const incomingToken = hash.get("workToken") || "";
    if (incomingToken) {
      history.replaceState(null, "", location.pathname + location.search);
      sessionStorage.setItem("kp_work_token", incomingToken);
      sessionStorage.removeItem("kp_pin");
    }
    const workToken = incomingToken || sessionStorage.getItem("kp_work_token") || "";
    const pin = sessionStorage.getItem("kp_pin") || "";
    if (!workToken && !pin) return;
    state.workToken = workToken; state.pin = workToken ? "" : pin;
    try { const result = await api("login"); state.user = result.user; state.users = result.users || []; await loadRecords(); showApp(); }
    catch { logout(); }
  }

  bind(); restoreSession();
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));

  window.KPDateLogic = { expiryDate, warningDate, statusOf, validateDateParts };
})();
