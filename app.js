/* =========================================================================
   Ari's Inventory Assistant — app.js
   Vanilla JS + Firebase (Auth, Firestore, Storage). No build step.
   Deploy target: GitHub Pages. See README.md for setup instructions.
   ========================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  query, where, onSnapshot, writeBatch, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

/* -------------------------------------------------------------------------
   1. FIREBASE CONFIG — fill this in with YOUR Firebase project's values.
   Firebase console -> Project settings -> General -> Your apps -> Web app.
   These values are safe to commit/publish; access is controlled by the
   Firestore & Storage security rules (firestore.rules / storage.rules),
   not by hiding this config.
   ------------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyASAd2iDl7dkc-HWpyomSJ4MuC6A5Bx0jQ",
  authDomain: "ari-s-inventory-assistant.firebaseapp.com",
  projectId: "ari-s-inventory-assistant",
  storageBucket: "ari-s-inventory-assistant.firebasestorage.app",
  messagingSenderId: "143138023127",
  appId: "1:143138023127:web:c76470c7ae4ad467a5f292"
};

const firebaseConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");

let app, auth, db, storage;
const googleProvider = new GoogleAuthProvider();
if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

/* -------------------------------------------------------------------------
   2. Constants
   ------------------------------------------------------------------------- */
const DEFAULT_CATEGORIES = ["Earrings", "Necklace", "Bracelet", "Ring", "Brooch", "Anklet", "Other"];
const CHART_COLORS = ["#FF7A59", "#5FA8D3", "#8BC34A", "#FF8FAB", "#B79CED", "#FFC93C", "#4FB0A5", "#E36588"];

const TABS = [
  { key: "input", label: "Add Items", emoji: "➕" },
  { key: "live", label: "Live Inventory", emoji: "📦" },
  { key: "sold", label: "Sold Inventory", emoji: "🛍️" },
  { key: "ledger", label: "Total Ledger", emoji: "📋" },
  { key: "stats", label: "Stats", emoji: "📊" },
  { key: "sets", label: "Manage Sets", emoji: "🌸" },
  { key: "friends", label: "Friends", emoji: "👯" },
];

const LIVE_FIELD_DEFS = [
  { key: "name", label: "Name" },
  { key: "quantity", label: "Quantity" },
  { key: "count", label: "Count / unit" },
  { key: "category", label: "Category" },
  { key: "setType", label: "Set type", get: (r) => r.setType || "" },
  { key: "photo", label: "Photo" },
];
const SOLD_FIELD_DEFS = [
  { key: "name", label: "Name" },
  { key: "quantity", label: "Quantity sold" },
  { key: "count", label: "Count / unit" },
  { key: "category", label: "Category" },
  { key: "setType", label: "Set type", get: (r) => r.setType || "" },
  { key: "revenue", label: "Revenue", get: (r) => Number((r.revenue || 0).toFixed(2)) },
  { key: "lastDate", label: "Last sold", get: (r) => r.lastDate || "" },
  { key: "photo", label: "Photo" },
];

/* -------------------------------------------------------------------------
   3. State
   ------------------------------------------------------------------------- */
const state = {
  user: null,
  profile: null,   // { uid, email, displayName, photoURL, groupId }
  group: null,     // { id, members:[{uid,email}], ownerUid }
  entries: [],
  sets: [],
  soldTx: [],
  invitesSent: [],
  invitesReceived: [],
  ui: {
    activeTab: "input",
    toast: "",
    modal: null,
    form: { name: "", photo: "", quantity: "1", count: "1", category: DEFAULT_CATEGORIES[0], setType: "", date: todayISO() },
    uploading: false,
    hist: { search: "", dateFrom: "", dateTo: "", category: "", setType: "", page: 0, selected: {} },
    sort: { live: "name", sold: "name" },
    ledger: { sortKey: "name", sortDir: 1 },
    stats: { groupBy: "name" },
    newSetName: "",
    friendEmail: "",
  },
};

let lastGroupId = null;
let creatingProfile = false;
const subs = { profile: null, invitesReceived: null };
const groupSubs = { group: null, entries: null, sets: null, soldTx: null, invitesSent: null };
const charts = { pie1: null, pie2: null, bar: null };

/* -------------------------------------------------------------------------
   4. Small helpers
   ------------------------------------------------------------------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtMoney(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
function monthKey(iso) { return iso ? iso.slice(0, 7) : "unknown"; }
function norm(s) { return (s || "").trim().toLowerCase(); }
function setDeep(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
}
function getDeep(obj, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj); }

const DANDELION_SVG = `<svg width="54" height="54" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="6" fill="#F4EFE2"/>
  ${Array.from({ length: 14 }).map((_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const x1 = 50 + Math.cos(a) * 8, y1 = 50 + Math.sin(a) * 8;
    const x2 = 50 + Math.cos(a) * 32, y2 = 50 + Math.sin(a) * 32;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#D8CBAE" stroke-width="1.4"/><circle cx="${x2}" cy="${y2}" r="2.4" fill="#F4EFE2" stroke="#D8CBAE" stroke-width="0.6"/>`;
  }).join("")}
</svg>`;

function resizeImageToBlob(file, maxDim = 480, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) { if (width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; } }
        else { if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; } }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------
   5. Aggregation (live / sold / ledger all derive from entries + soldTx)
   ------------------------------------------------------------------------- */
function aggregateEntries(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const key = norm(e.name);
    if (!map.has(key)) map.set(key, { name: e.name, quantity: 0, category: e.category, setType: e.setType, count: e.count, photo: e.photo, _latest: -1 });
    const g = map.get(key);
    g.quantity += Number(e.quantity) || 0;
    if (e.createdAt >= g._latest) {
      g._latest = e.createdAt; g.category = e.category; g.setType = e.setType; g.count = e.count;
      if (e.photo) g.photo = e.photo;
    }
    if (!g.photo && e.photo) g.photo = e.photo;
  });
  return map;
}
function aggregateSold(soldTx) {
  const map = new Map();
  soldTx.forEach((t) => {
    const key = norm(t.name);
    if (!map.has(key)) map.set(key, { name: t.name, quantity: 0, revenue: 0, category: t.category, setType: t.setType, count: t.count, photo: t.photo, lastDate: t.date || "" });
    const g = map.get(key);
    g.quantity += Number(t.quantity) || 0;
    g.revenue += (Number(t.quantity) || 0) * (Number(t.price) || 0);
    if ((t.date || "") > g.lastDate) g.lastDate = t.date;
    if (!g.photo && t.photo) g.photo = t.photo;
  });
  return map;
}
function getLiveItems() {
  const liveMap = aggregateEntries(state.entries);
  const soldMap = aggregateSold(state.soldTx);
  return Array.from(liveMap.values())
    .map((g) => {
      const sold = soldMap.get(norm(g.name));
      return { ...g, quantity: g.quantity - (sold ? sold.quantity : 0) };
    })
    .filter((x) => x.quantity > 0);
}
function getSoldItems() {
  return Array.from(aggregateSold(state.soldTx).values()).filter((x) => x.quantity > 0);
}
function distinctEntryOptions() {
  const map = new Map();
  [...state.entries].sort((a, b) => a.createdAt - b.createdAt).forEach((e) => map.set(norm(e.name), e));
  return Array.from(map.values());
}
function allCategories() {
  const fromEntries = state.entries.map((e) => e.category).filter(Boolean);
  return Array.from(new Set([...DEFAULT_CATEGORIES, ...fromEntries]));
}

/* -------------------------------------------------------------------------
   6. Firestore CRUD
   ------------------------------------------------------------------------- */
async function addEntry() {
  const f = state.ui.form;
  if (!f.name || !f.name.trim()) { showToast("Give it a name first! 🌼"); return; }
  const groupId = state.profile.groupId;
  await addDoc(collection(db, "entries"), {
    groupId, createdBy: state.user.uid,
    name: f.name.trim(), photo: f.photo || "",
    quantity: Math.max(1, Number(f.quantity) || 1),
    count: Math.max(1, Number(f.count) || 1),
    category: f.category || "", setType: f.setType || "",
    date: f.date || todayISO(), createdAt: Date.now(),
  });
  state.ui.form = { name: "", photo: "", quantity: "1", count: "1", category: f.category, setType: f.setType, date: f.date || todayISO() };
  showToast("Added to your inventory! ✨");
  renderAll();
}
async function deleteEntry(id) { await deleteDoc(doc(db, "entries", id)); }
async function deleteManyEntries(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((id) => batch.delete(doc(db, "entries", id)));
    await batch.commit();
  }
}
async function createSet() {
  const name = (state.ui.newSetName || "").trim();
  if (!name) return;
  if (state.sets.some((s) => norm(s.name) === norm(name))) { showToast("That set already exists."); return; }
  await addDoc(collection(db, "sets"), { groupId: state.profile.groupId, name, createdAt: Date.now() });
  state.ui.newSetName = "";
  showToast("Set created! 🌟");
  renderAll();
}
async function removeSet(id) { await deleteDoc(doc(db, "sets", id)); showToast("Set removed."); }

async function sellItem(item, qty, price, date) {
  await addDoc(collection(db, "soldTx"), {
    groupId: state.profile.groupId, createdBy: state.user.uid,
    name: item.name, category: item.category || "", setType: item.setType || "",
    count: item.count || 1, photo: item.photo || "",
    quantity: qty, price: price || 0, date: date || todayISO(), createdAt: Date.now(),
  });
}
async function addBackToLive(item, qty) {
  const key = norm(item.name);
  const txs = state.soldTx
    .filter((t) => norm(t.name) === key)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
  let remaining = qty;
  const batch = writeBatch(db);
  for (const t of txs) {
    if (remaining <= 0) break;
    const take = Math.min(t.quantity, remaining);
    const newQty = t.quantity - take;
    const ref = doc(db, "soldTx", t.id);
    if (newQty <= 0) batch.delete(ref); else batch.update(ref, { quantity: newQty });
    remaining -= take;
  }
  await batch.commit();
}

async function handlePhotoChange(fileInputEl) {
  const file = fileInputEl.files && fileInputEl.files[0];
  if (!file) return;
  state.ui.uploading = true; renderAll();
  try {
    const blob = await resizeImageToBlob(file);
    const path = `photos/${state.user.uid}/${Date.now()}.jpg`;
    const sref = storageRef(storage, path);
    await uploadBytes(sref, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(sref);
    state.ui.form.photo = url;
  } catch (e) {
    console.error(e);
    showToast(`Couldn't upload that photo${e && e.code ? ` (${e.code})` : ""} — try again.`);
  }
  state.ui.uploading = false;
  renderAll();
}

/* ---- Friends / group linking ----
   NOTE on ordering: the Firestore security rules determine group
   membership by reading users/{uid}.groupId. Every step below is ordered
   so that, at the moment of each write, the rule's membership check still
   evaluates true — reassign data & leave the old group first (while still
   a member), THEN switch profile.groupId, THEN join the new group. */
async function sendInvite() {
  const email = (state.ui.friendEmail || "").trim().toLowerCase();
  if (!email) { showToast("Enter an email first."); return; }
  if (email === (state.user.email || "").toLowerCase()) { showToast("That's your own email! 😄"); return; }
  if (state.invitesSent.some((i) => i.toEmail === email)) { showToast("Already invited."); return; }
  await addDoc(collection(db, "linkInvites"), {
    fromUid: state.user.uid, fromEmail: state.user.email, fromGroupId: state.profile.groupId,
    toEmail: email, status: "pending", createdAt: Date.now(),
  });
  state.ui.friendEmail = "";
  showToast("Invite sent! 💌");
  renderAll();
}
async function cancelInvite(id) { await deleteDoc(doc(db, "linkInvites", id)); }
async function declineInvite(id) { await updateDoc(doc(db, "linkInvites", id), { status: "declined" }); }

async function acceptInvite(invite) {
  const myOldGroup = state.profile.groupId;
  const newGroup = invite.fromGroupId;
  if (myOldGroup === newGroup) { await updateDoc(doc(db, "linkInvites", invite.id), { status: "accepted" }); return; }

  for (const coll of ["entries", "sets", "soldTx"]) {
    const snap = await getDocs(query(collection(db, coll), where("groupId", "==", myOldGroup)));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.update(d.ref, { groupId: newGroup }));
      await batch.commit();
    }
  }
  const oldSnap = await getDoc(doc(db, "groups", myOldGroup));
  if (oldSnap.exists()) {
    const members = (oldSnap.data().members || []).filter((m) => m.uid !== state.user.uid);
    await setDoc(doc(db, "groups", myOldGroup), { ...oldSnap.data(), members }, { merge: true });
  }
  await updateDoc(doc(db, "users", state.user.uid), { groupId: newGroup });
  const newSnap = await getDoc(doc(db, "groups", newGroup));
  const newMembers = newSnap.exists() ? (newSnap.data().members || []) : [];
  if (!newMembers.some((m) => m.uid === state.user.uid)) {
    newMembers.push({ uid: state.user.uid, email: state.user.email });
    await setDoc(doc(db, "groups", newGroup), { ...(newSnap.data() || {}), members: newMembers }, { merge: true });
  }
  await updateDoc(doc(db, "linkInvites", invite.id), { status: "accepted" });
  showToast("You joined the shared inventory! 🎉");
}

async function leaveGroup() {
  const oldGroup = state.profile.groupId;
  const newGroup = `${state.user.uid}-${Date.now()}`;
  for (const coll of ["entries", "soldTx"]) {
    const snap = await getDocs(query(collection(db, coll), where("groupId", "==", oldGroup), where("createdBy", "==", state.user.uid)));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.update(d.ref, { groupId: newGroup }));
      await batch.commit();
    }
  }
  const oldSnap = await getDoc(doc(db, "groups", oldGroup));
  if (oldSnap.exists()) {
    const members = (oldSnap.data().members || []).filter((m) => m.uid !== state.user.uid);
    await setDoc(doc(db, "groups", oldGroup), { ...oldSnap.data(), members }, { merge: true });
  }
  await updateDoc(doc(db, "users", state.user.uid), { groupId: newGroup });
  await setDoc(doc(db, "groups", newGroup), { members: [{ uid: state.user.uid, email: state.user.email }], ownerUid: state.user.uid, createdAt: Date.now() });
  showToast("You left the shared inventory — your own items came with you.");
}

/* -------------------------------------------------------------------------
   7. Auth + realtime subscriptions
   ------------------------------------------------------------------------- */
async function handleSignIn() {
  const errEl = document.getElementById("authError");
  errEl.classList.add("hidden");
  try { await signInWithPopup(auth, googleProvider); }
  catch (e) { errEl.textContent = e.message || "Sign-in failed. Please try again."; errEl.classList.remove("hidden"); }
}
async function handleSignOut() { await signOut(auth); }

function cleanupGroupSubs() { Object.keys(groupSubs).forEach((k) => { if (groupSubs[k]) groupSubs[k](); groupSubs[k] = null; }); }
function cleanupAllSubs() {
  if (subs.profile) subs.profile();
  if (subs.invitesReceived) subs.invitesReceived();
  subs.profile = null; subs.invitesReceived = null;
  cleanupGroupSubs();
  lastGroupId = null;
}

function subscribeGroupData(groupId) {
  cleanupGroupSubs();
  groupSubs.group = onSnapshot(doc(db, "groups", groupId), (snap) => {
    state.group = snap.exists() ? { id: groupId, ...snap.data() } : null;
    renderAll();
  });
  groupSubs.entries = onSnapshot(query(collection(db, "entries"), where("groupId", "==", groupId)), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  groupSubs.sets = onSnapshot(query(collection(db, "sets"), where("groupId", "==", groupId)), (snap) => {
    state.sets = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
    renderAll();
  });
  groupSubs.soldTx = onSnapshot(query(collection(db, "soldTx"), where("groupId", "==", groupId)), (snap) => {
    state.soldTx = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  groupSubs.invitesSent = onSnapshot(query(collection(db, "linkInvites"), where("fromUid", "==", state.user.uid)), (snap) => {
    state.invitesSent = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status === "pending");
    renderAll();
  });
}

function subscribeProfile(uid, email, displayName, photoURL) {
  return onSnapshot(doc(db, "users", uid), async (snap) => {
    if (!snap.exists()) {
      if (creatingProfile) return;
      creatingProfile = true;
      const groupId = uid;
      try {
        await setDoc(doc(db, "users", uid), { email, displayName: displayName || "", photoURL: photoURL || "", groupId, createdAt: Date.now() });
        await setDoc(doc(db, "groups", groupId), { members: [{ uid, email }], ownerUid: uid, createdAt: Date.now() });
      } finally { creatingProfile = false; }
      return; // our own write above will re-trigger this listener
    }
    const data = snap.data();
    state.profile = { uid, ...data };
    if (data.groupId !== lastGroupId) { lastGroupId = data.groupId; subscribeGroupData(data.groupId); }
    renderAll();
  });
}
function subscribeInvitesReceived(email) {
  return onSnapshot(query(collection(db, "linkInvites"), where("toEmail", "==", email)), (snap) => {
    state.invitesReceived = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status === "pending");
    renderAll();
  });
}

function handleAuthChange(user) {
  cleanupAllSubs();
  const signedOutEl = document.getElementById("signedOutScreen");
  const appEl = document.getElementById("appRoot");
  if (!user) {
    state.user = null; state.profile = null; state.group = null;
    state.entries = []; state.sets = []; state.soldTx = []; state.invitesSent = []; state.invitesReceived = [];
    appEl.classList.add("hidden");
    signedOutEl.classList.remove("hidden");
    return;
  }
  state.user = user;
  signedOutEl.classList.add("hidden");
  appEl.classList.remove("hidden");
  document.getElementById("userAvatar").src = user.photoURL || "";
  document.getElementById("userName").textContent = user.displayName || user.email;
  subs.profile = subscribeProfile(user.uid, user.email, user.displayName, user.photoURL);
  subs.invitesReceived = subscribeInvitesReceived(user.email);
  renderAll();
}

/* -------------------------------------------------------------------------
   8. Render engine
   ------------------------------------------------------------------------- */
function rerenderPreservingFocus(containerId, htmlFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const active = document.activeElement;
  let focusInfo = null;
  if (active && container.contains(active) && active.id) {
    focusInfo = { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }
  container.innerHTML = htmlFn();
  if (focusInfo) {
    const el = document.getElementById(focusInfo.id);
    if (el) {
      el.focus();
      if (typeof focusInfo.start === "number" && el.setSelectionRange) {
        try { el.setSelectionRange(focusInfo.start, focusInfo.end); } catch (_) { /* not a text-ish input */ }
      }
    }
  }
}
function renderTabBarUI() {
  const el = document.getElementById("tabBar");
  if (!el) return;
  el.innerHTML = TABS.map((t) => {
    const active = state.ui.activeTab === t.key;
    const badge = t.key === "friends" && state.invitesReceived.length > 0 ? `<span class="badge">${state.invitesReceived.length}</span>` : "";
    return `<button class="tab-btn ${active ? "active" : ""}" data-action="switch-tab" data-tab="${t.key}">${t.emoji} ${esc(t.label)} ${badge}</button>`;
  }).join("");
}
function renderToastUI() {
  const el = document.getElementById("toast");
  if (!el) return;
  if (state.ui.toast) { el.textContent = state.ui.toast; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}
let toastTimer = null;
function showToast(msg) {
  state.ui.toast = msg;
  renderToastUI();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.ui.toast = ""; renderToastUI(); }, 2400);
}
function renderLoadingHTML() {
  return `<div class="loading-screen">${DANDELION_SVG}<p>Fetching your treasures…</p></div>`;
}
function renderActiveTabHTML() {
  if (!state.profile) return renderLoadingHTML();
  switch (state.ui.activeTab) {
    case "input": return renderInputTabHTML();
    case "live": return renderInventoryTabHTML("live");
    case "sold": return renderInventoryTabHTML("sold");
    case "ledger": return renderLedgerTabHTML();
    case "stats": return renderStatsTabHTML();
    case "sets": return renderSetsTabHTML();
    case "friends": return renderFriendsTabHTML();
    default: return "";
  }
}
function renderModalHTML() {
  const m = state.ui.modal;
  if (!m) return "";
  if (m.kind === "confirm") return renderConfirmModalHTML(m);
  if (m.kind === "quantity") return renderQuantityModalHTML(m);
  if (m.kind === "export") return renderExportModalHTML(m);
  return "";
}
function renderAll() {
  renderTabBarUI();
  rerenderPreservingFocus("tabContent", renderActiveTabHTML);
  rerenderPreservingFocus("modalRoot", renderModalHTML);
  renderToastUI();
  if (state.profile && state.ui.activeTab === "stats") mountStatsCharts();
}
function openConfirmModal({ title, body, confirmLabel = "Delete", danger = true, onConfirm }) {
  state.ui.modal = { kind: "confirm", title, body, confirmLabel, danger, onConfirm };
  renderAll();
}
function closeModal() { state.ui.modal = null; renderAll(); }
async function handleModalConfirm() {
  const m = state.ui.modal;
  state.ui.modal = null;
  renderAll();
  if (m && m.onConfirm) await m.onConfirm();
}
function renderConfirmModalHTML(m) {
  return `
  <div class="modal-overlay">
    <div class="modal-box">
      <h3>${esc(m.title)}</h3>
      <p class="desc">${esc(m.body)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="modal-cancel">Cancel</button>
        <button class="btn ${m.danger ? "btn-danger" : "btn-green"}" data-action="modal-confirm">${esc(m.confirmLabel)}</button>
      </div>
    </div>
  </div>`;
}

/* -------------------------------------------------------------------------
   9. Input tab
   ------------------------------------------------------------------------- */
function renderInputTabHTML() {
  const f = state.ui.form;
  const sets = state.sets;
  const cats = allCategories();
  const names = distinctEntryOptions();

  const h = state.ui.hist;
  const filtered = state.entries
    .filter((e) => (h.search ? norm(e.name).includes(norm(h.search)) : true))
    .filter((e) => (h.dateFrom ? e.date >= h.dateFrom : true))
    .filter((e) => (h.dateTo ? e.date <= h.dateTo : true))
    .filter((e) => (h.category ? e.category === h.category : true))
    .filter((e) => (h.setType ? e.setType === h.setType : true))
    .sort((a, b) => b.createdAt - a.createdAt);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  if (h.page >= pageCount) h.page = pageCount - 1;
  if (h.page < 0) h.page = 0;
  const pageItems = filtered.slice(h.page * 10, h.page * 10 + 10);
  const distinctCats = Array.from(new Set(state.entries.map((e) => e.category).filter(Boolean)));
  const distinctSets = Array.from(new Set(state.entries.map((e) => e.setType).filter(Boolean)));
  const selectedCount = Object.values(h.selected).filter(Boolean).length;
  const pageIds = pageItems.map((e) => e.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => h.selected[id]);

  return `
  <div class="card">
    <h2 class="section-title">✨ Add an inventory item</h2>
    <form data-action="submit-entry-form">
      <div class="form-grid">
        <div class="field">
          <span class="field-label">Item name</span>
          <input class="input" id="entryNameInput" list="nameSuggestions" placeholder="e.g. Gold Hoop Earrings"
            data-action="name-input" value="${esc(f.name)}" required />
          <datalist id="nameSuggestions">${names.map((n) => `<option value="${esc(n.name)}"></option>`).join("")}</datalist>
        </div>

        <div class="field">
          <span class="field-label">Photo (optional)</span>
          <span class="field-hint">Snap one from your iPhone or pick from your library</span>
          <div style="display:flex; align-items:center; gap:8px;">
            ${state.ui.uploading
              ? `<span style="font-size:12px; color:var(--ink-soft); font-weight:700;">Uploading photo…</span>`
              : `<input type="file" accept="image/*" data-action="photo-upload" style="font-size:12px;" />`}
            ${f.photo ? `<img src="${esc(f.photo)}" alt="" style="width:40px;height:40px;border-radius:12px;object-fit:cover;border:2px solid var(--line);" />` : ""}
          </div>
        </div>

        <div class="field">
          <span class="field-label">Quantity</span>
          <input class="input" id="bind-form.quantity" type="number" min="1" data-bind="form.quantity" value="${esc(f.quantity)}" />
        </div>

        <div class="field">
          <span class="field-label">Count</span>
          <span class="field-hint">Pieces per unit</span>
          <input class="input" id="bind-form.count" type="number" min="1" data-bind="form.count" value="${esc(f.count)}" />
        </div>

        <div class="field">
          <span class="field-label">Category</span>
          <input class="input" id="bind-form.category" list="categorySuggestions" data-bind="form.category" value="${esc(f.category)}" placeholder="Earrings, Necklace…" />
          <datalist id="categorySuggestions">${cats.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
        </div>

        <div class="field">
          <span class="field-label">Set type</span>
          <span class="field-hint">Optional — manage these in the Sets tab</span>
          <select class="input" id="bind-form.setType" data-bind="form.setType">
            <option value="">— None —</option>
            ${sets.map((s) => `<option value="${esc(s.name)}" ${f.setType === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <span class="field-label">Date entered</span>
          <div style="display:flex; gap:8px;">
            <input class="input" id="entryDateInput" type="date" data-bind="form.date" value="${esc(f.date)}" style="flex:1;" />
            <button type="button" class="btn btn-secondary" data-action="open-date-picker" data-target="entryDateInput">📅</button>
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:14px;">
        <button type="submit" class="btn btn-primary" ${state.ui.uploading ? "disabled" : ""}>➕ Add entry</button>
      </div>
    </form>
  </div>

  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <h2 class="section-title" style="margin:0;">📋 Entry history</h2>
      ${selectedCount > 0 ? `<button class="btn btn-danger" data-action="request-delete-many">🗑️ Delete selected (${selectedCount})</button>` : ""}
    </div>

    <div class="filters-grid">
      <div class="search-wrap">
        🔍<input class="input" id="bind-hist.search" placeholder="Search name" data-bind="hist.search" value="${esc(h.search)}" />
      </div>
      <input class="input" id="bind-hist.dateFrom" type="date" data-bind="hist.dateFrom" value="${esc(h.dateFrom)}" title="From date" />
      <input class="input" id="bind-hist.dateTo" type="date" data-bind="hist.dateTo" value="${esc(h.dateTo)}" title="To date" />
      <select class="input" id="bind-hist.category" data-bind="hist.category">
        <option value="">All categories</option>
        ${distinctCats.map((c) => `<option value="${esc(c)}" ${h.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
      <select class="input" id="bind-hist.setType" data-bind="hist.setType">
        <option value="">All set types</option>
        ${distinctSets.map((s) => `<option value="${esc(s)}" ${h.setType === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
    </div>

    ${pageItems.length === 0 ? `<div class="empty-state">${DANDELION_SVG}<p>No entries match yet — try adding one above!</p></div>` : `
    <div class="table-wrap desktop-only">
      <table class="data-table">
        <thead><tr>
          <th><input type="checkbox" data-action="toggle-select-page" ${allPageSelected ? "checked" : ""} /></th>
          <th>Photo</th><th>Name</th><th>Qty</th><th>Count</th><th>Category</th><th>Set</th><th>Date</th><th></th>
        </tr></thead>
        <tbody>
          ${pageItems.map((e) => `
          <tr>
            <td><input type="checkbox" data-action="toggle-select-entry" data-id="${e.id}" ${h.selected[e.id] ? "checked" : ""} /></td>
            <td>${e.photo ? `<img class="thumb" src="${esc(e.photo)}" />` : `<div class="thumb-placeholder">🌼</div>`}</td>
            <td style="font-weight:700;">${esc(e.name)}</td>
            <td>${e.quantity}</td>
            <td>${e.count}</td>
            <td>${e.category ? `<span class="chip" style="background:var(--blue-soft);">${esc(e.category)}</span>` : "—"}</td>
            <td>${e.setType ? `<span class="chip" style="background:var(--pink-soft);">${esc(e.setType)}</span>` : "—"}</td>
            <td style="color:var(--ink-soft);">${fmtDate(e.date)}</td>
            <td style="text-align:right;"><button class="icon-btn" data-action="request-delete-entry" data-id="${e.id}" data-name="${esc(e.name)}">🗑️</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="mobile-row-list mobile-only">
      ${pageItems.map((e) => `
      <div class="mobile-row">
        <input type="checkbox" data-action="toggle-select-entry" data-id="${e.id}" ${h.selected[e.id] ? "checked" : ""} />
        ${e.photo ? `<img class="thumb" src="${esc(e.photo)}" />` : `<div class="thumb-placeholder">🌼</div>`}
        <div class="row-info">
          <div class="name">${esc(e.name)}</div>
          <div class="meta">Qty ${e.quantity} · ${esc(e.category || "—")} ${e.setType ? "· " + esc(e.setType) : ""}</div>
          <div class="meta">${fmtDate(e.date)}</div>
        </div>
        <button class="icon-btn" data-action="request-delete-entry" data-id="${e.id}" data-name="${esc(e.name)}">🗑️</button>
      </div>`).join("")}
    </div>
    <div class="pagination">
      <span>Page ${h.page + 1} of ${pageCount} · ${filtered.length} entries</span>
      <div class="btns">
        <button class="btn btn-secondary" data-action="prev-page" ${h.page === 0 ? "disabled" : ""}>◀</button>
        <button class="btn btn-secondary" data-action="next-page" ${h.page >= pageCount - 1 ? "disabled" : ""}>Next 10 ▶</button>
      </div>
    </div>
    `}
  </div>`;
}

/* -------------------------------------------------------------------------
   10. Live / Sold inventory tab (shared renderer)
   ------------------------------------------------------------------------- */
function renderInventoryCardHTML(item, mode) {
  const badgeLabel = mode === "live" ? "In stock" : "Sold";
  const badgeColor = mode === "live" ? "var(--green-soft)" : "var(--orange-soft)";
  return `
  <button class="inv-card" data-action="open-item-modal" data-mode="${mode}" data-key="${esc(norm(item.name))}">
    ${item.photo ? `<img class="photo" src="${esc(item.photo)}" />` : `<div class="photo-placeholder">${DANDELION_SVG}</div>`}
    <div class="info">
      <div class="name">${esc(item.name)}</div>
      <div class="chips">
        <span class="chip" style="background:${badgeColor};">${badgeLabel}: ${item.quantity}</span>
        ${item.category ? `<span class="chip" style="background:var(--blue-soft);">${esc(item.category)}</span>` : ""}
        ${item.setType ? `<span class="chip" style="background:var(--pink-soft);">${esc(item.setType)}</span>` : ""}
      </div>
      <div class="sub">${item.count > 1 ? `${item.count} pieces/unit` : "1 piece/unit"}${item.revenue !== undefined ? ` · ${fmtMoney(item.revenue)} revenue` : ""}</div>
    </div>
  </button>`;
}
function renderInventoryTabHTML(mode) {
  const isLive = mode === "live";
  let items = isLive ? getLiveItems() : getSoldItems();
  const sortKey = state.ui.sort[mode];
  items = [...items].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "quantity") return b.quantity - a.quantity;
    if (sortKey === "category") return (a.category || "").localeCompare(b.category || "");
    if (sortKey === "setType") return (a.setType || "").localeCompare(b.setType || "");
    return 0;
  });
  return `
  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <h2 class="section-title" style="margin:0;">${isLive ? "📦 Live inventory" : "🛍️ Sold inventory"}</h2>
      <div style="display:flex; align-items:center; gap:8px;">
        <select class="input" id="bind-sort.${mode}" style="padding:6px 10px; font-size:12px;" data-bind="sort.${mode}">
          <option value="name" ${sortKey === "name" ? "selected" : ""}>Alphabetical</option>
          <option value="quantity" ${sortKey === "quantity" ? "selected" : ""}>Quantity</option>
          <option value="category" ${sortKey === "category" ? "selected" : ""}>Category</option>
          <option value="setType" ${sortKey === "setType" ? "selected" : ""}>Set type</option>
        </select>
        <button class="btn btn-secondary" data-action="open-export" data-mode="${mode}">⬇️ Export</button>
      </div>
    </div>
    ${items.length === 0
      ? `<div class="empty-state">${DANDELION_SVG}<p>${isLive ? "Nothing in stock yet — add items in the Add Items tab." : "No sales recorded yet."}</p></div>`
      : `<div class="inv-grid">${items.map((i) => renderInventoryCardHTML(i, mode)).join("")}</div>`}
  </div>`;
}

/* -------------------------------------------------------------------------
   11. Quantity modal (sell / add-back)
   ------------------------------------------------------------------------- */
function openQuantityModal(mode, key) {
  const items = mode === "live" ? getLiveItems() : getSoldItems();
  const item = items.find((i) => norm(i.name) === key);
  if (!item) return;
  state.ui.modal = { kind: "quantity", mode, item, max: item.quantity, qty: "1", price: "", date: todayISO() };
  renderAll();
}
function renderQuantityModalHTML(m) {
  const isSell = m.mode === "live";
  return `
  <div class="modal-overlay">
    <div class="modal-box">
      <div class="modal-header-item">
        ${m.item.photo ? `<img src="${esc(m.item.photo)}" style="width:48px;height:48px;border-radius:16px;object-fit:cover;border:2px solid var(--line);" />` : `<div class="photo-placeholder" style="width:48px;height:48px;border-radius:16px;">🌼</div>`}
        <div>
          <h3 style="margin:0; font-size:18px;">${esc(m.item.name)}</h3>
          <p style="margin:0; font-size:12px; color:var(--ink-soft);">${isSell ? `${m.max} in stock` : `${m.max} sold, ready to return`}</p>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:14px;">
        <div class="field">
          <span class="field-label">${isSell ? "Quantity sold" : "Quantity to return to live"}</span>
          <input class="input" id="qtyInput" type="number" min="1" max="${m.max}" data-bind="modal.qty" value="${esc(m.qty)}" />
        </div>
        ${isSell ? `
        <div class="field">
          <span class="field-label">Price per unit (optional)</span>
          <span class="field-hint">Used for profit stats</span>
          <input class="input" id="bind-modal.price" type="number" min="0" step="0.01" placeholder="0.00" data-bind="modal.price" value="${esc(m.price)}" />
        </div>
        <div class="field">
          <span class="field-label">Date sold</span>
          <input class="input" id="bind-modal.date" type="date" data-bind="modal.date" value="${esc(m.date)}" />
        </div>` : ""}
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="modal-cancel">Cancel</button>
        <button class="btn ${isSell ? "btn-primary" : "btn-green"}" data-action="quantity-confirm">${isSell ? "🛍️ Mark sold" : "🔄 Add back"}</button>
      </div>
    </div>
  </div>`;
}
async function handleQuantityConfirm() {
  const m = state.ui.modal;
  if (!m || m.kind !== "quantity") return;
  const qty = Math.max(1, Math.min(m.max, Number(m.qty) || 1));
  state.ui.modal = null;
  renderAll();
  if (m.mode === "live") {
    await sellItem(m.item, qty, Number(m.price) || 0, m.date || todayISO());
    showToast(`Sold ${qty} × ${m.item.name}! 💸`);
  } else {
    await addBackToLive(m.item, qty);
    showToast(`Returned ${qty} × ${m.item.name} to live inventory.`);
  }
}

/* -------------------------------------------------------------------------
   12. Export modal (customizable Excel export)
   ------------------------------------------------------------------------- */
function openExportModal(mode, items) {
  const fieldDefs = mode === "live" ? LIVE_FIELD_DEFS : SOLD_FIELD_DEFS;
  const fields = {}; fieldDefs.forEach((f) => (fields[f.key] = true));
  const fieldOrder = fieldDefs.map((f) => f.key);
  const catOptions = Array.from(new Set(items.map((i) => i.category || "Uncategorized")));
  const setOptions = Array.from(new Set(items.map((i) => i.setType || "No set")));
  const cats = {}; catOptions.forEach((c) => (cats[c] = true));
  const setTypes = {}; setOptions.forEach((s) => (setTypes[s] = true));
  state.ui.modal = { kind: "export", mode, items, fieldDefs, fields, fieldOrder, catOptions, setOptions, cats, setTypes, filename: mode === "live" ? "live-inventory" : "sold-inventory", exporting: false };
  renderAll();
}
function renderExportModalHTML(m) {
  return `
  <div class="modal-overlay">
    <div class="modal-box" style="max-width:520px;">
      <h3>⬇️ Export to Excel</h3>
      <p class="desc">Choose what to include, embed each item's photo, and set the column order with the arrows.</p>

      <div class="modal-section-label">Columns to include & order <button data-action="toggle-all-export-fields">Toggle all</button></div>
      <div class="reorder-list" style="margin-bottom:16px;">
        ${m.fieldOrder.map((key, idx) => {
          const f = m.fieldDefs.find((fd) => fd.key === key);
          if (!f) return "";
          return `
          <div class="checkbox-item" style="justify-content:space-between;">
            <label style="display:flex; align-items:center; gap:8px; flex:1; cursor:pointer;">
              <input type="checkbox" data-action="toggle-export-field" data-key="${esc(f.key)}" ${m.fields[f.key] ? "checked" : ""} /> ${esc(f.label)}
            </label>
            <div style="display:flex; gap:2px;">
              <button type="button" class="icon-btn" data-action="move-export-field-up" data-key="${esc(f.key)}" ${idx === 0 ? "disabled" : ""}>▲</button>
              <button type="button" class="icon-btn" data-action="move-export-field-down" data-key="${esc(f.key)}" ${idx === m.fieldOrder.length - 1 ? "disabled" : ""}>▼</button>
            </div>
          </div>`;
        }).join("")}
      </div>

      ${m.catOptions.length > 0 ? `
      <div class="modal-section-label">Categories to include <button data-action="toggle-all-export-cats">Toggle all</button></div>
      <div class="checkbox-grid" style="margin-bottom:16px;">
        ${m.catOptions.map((c) => `
        <label class="checkbox-item" style="background:var(--blue-soft);"><input type="checkbox" data-action="toggle-export-cat" data-key="${esc(c)}" ${m.cats[c] ? "checked" : ""} /> ${esc(c)}</label>`).join("")}
      </div>` : ""}

      ${m.setOptions.length > 0 ? `
      <div class="modal-section-label">Set types to include <button data-action="toggle-all-export-settypes">Toggle all</button></div>
      <div class="checkbox-grid">
        ${m.setOptions.map((s) => `
        <label class="checkbox-item" style="background:var(--pink-soft);"><input type="checkbox" data-action="toggle-export-settype" data-key="${esc(s)}" ${m.setTypes[s] ? "checked" : ""} /> ${esc(s)}</label>`).join("")}
      </div>` : ""}

      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="modal-cancel" ${m.exporting ? "disabled" : ""}>Cancel</button>
        <button class="btn btn-primary" data-action="do-export" ${m.exporting ? "disabled" : ""}>${m.exporting ? "⏳ Exporting…" : "⬇️ Export"}</button>
      </div>
    </div>
  </div>`;
}
async function fetchImageAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function doExport() {
  const m = state.ui.modal;
  if (!m || m.kind !== "export" || m.exporting) return;
  m.exporting = true;
  renderAll();
  try {
    const ExcelJS = window.ExcelJS;
    const orderedFields = m.fieldOrder.map((k) => m.fieldDefs.find((f) => f.key === k)).filter((f) => f && m.fields[f.key]);
    const rows = m.items
      .filter((r) => m.cats[r.category || "Uncategorized"])
      .filter((r) => m.setTypes[r.setType || "No set"]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Inventory");
    ws.columns = orderedFields.map((f) => ({ header: f.label, key: f.key, width: f.key === "photo" ? 12 : 20 }));

    const photoColIndex = orderedFields.findIndex((f) => f.key === "photo");

    for (const r of rows) {
      const rowData = {};
      orderedFields.forEach((f) => { rowData[f.key] = f.key === "photo" ? "" : (f.get ? f.get(r) : r[f.key]); });
      const excelRow = ws.addRow(rowData);
      if (photoColIndex !== -1 && r.photo) {
        try {
          const dataUrl = await fetchImageAsDataUrl(r.photo);
          if (dataUrl) {
            const imgId = wb.addImage({ base64: dataUrl, extension: "jpeg" });
            ws.addImage(imgId, { tl: { col: photoColIndex, row: excelRow.number - 1 }, ext: { width: 56, height: 56 } });
            excelRow.height = 44;
          }
        } catch (err) { console.error("Image embed failed for", r.name, err); }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${m.filename}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeModal();
    showToast("Exported! 📥");
  } catch (e) {
    console.error(e);
    showToast("Export failed — try again.");
    m.exporting = false;
    renderAll();
  }
}

/* -------------------------------------------------------------------------
   13. Ledger tab
   ------------------------------------------------------------------------- */
function renderLedgerTabHTML() {
  const liveMap = aggregateEntries(state.entries);
  const soldMap = aggregateSold(state.soldTx);
  const keys = new Set([...liveMap.keys(), ...soldMap.keys()]);
  let rows = Array.from(keys).map((k) => {
    const l = liveMap.get(k), s = soldMap.get(k);
    const totalEntered = l ? l.quantity : 0;
    const totalSold = s ? s.quantity : 0;
    return {
      name: (l && l.name) || (s && s.name), category: (l && l.category) || (s && s.category) || "—",
      setType: (l && l.setType) || (s && s.setType) || "", totalEntered, totalSold, current: totalEntered - totalSold,
      percentSold: totalEntered > 0 ? (totalSold / totalEntered) * 100 : 0, revenue: s ? s.revenue : 0,
    };
  });
  const { sortKey, sortDir } = state.ui.ledger;
  rows = rows.sort((a, b) => {
    const r = typeof a[sortKey] === "string" ? a[sortKey].localeCompare(b[sortKey]) : a[sortKey] - b[sortKey];
    return r * sortDir;
  });
  const totals = rows.reduce((acc, r) => ({ entered: acc.entered + r.totalEntered, sold: acc.sold + r.totalSold, revenue: acc.revenue + r.revenue }), { entered: 0, sold: 0, revenue: 0 });
  const cols = [
    { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "setType", label: "Set" },
    { key: "totalEntered", label: "Lifetime total" }, { key: "totalSold", label: "Total sold" }, { key: "current", label: "In stock" },
    { key: "percentSold", label: "% sold" }, { key: "revenue", label: "Revenue" },
  ];
  return `
  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <h2 class="section-title" style="margin:0;">📋 Total ledger</h2>
      <div style="display:flex; gap:8px;">
        <span class="chip" style="background:var(--green-soft);">Lifetime: ${totals.entered}</span>
        <span class="chip" style="background:var(--orange-soft);">Sold: ${totals.sold}</span>
        <span class="chip" style="background:var(--pink-soft);">Revenue: ${fmtMoney(totals.revenue)}</span>
      </div>
    </div>
    ${rows.length === 0 ? `<div class="empty-state">${DANDELION_SVG}<p>Your ledger will fill up once you add and sell some items.</p></div>` : `
    <div class="table-wrap desktop-only">
      <table class="data-table">
        <thead><tr>
          ${cols.map((c) => `<th class="sortable" data-action="sort-ledger" data-key="${c.key}">${esc(c.label)} ${sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : ""}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
          <tr>
            <td style="font-weight:700;">${esc(r.name)}</td>
            <td><span class="chip" style="background:var(--blue-soft);">${esc(r.category)}</span></td>
            <td>${r.setType ? `<span class="chip" style="background:var(--pink-soft);">${esc(r.setType)}</span>` : "—"}</td>
            <td>${r.totalEntered}</td><td>${r.totalSold}</td>
            <td style="font-weight:700; color:var(--green);">${r.current}</td>
            <td>${r.percentSold.toFixed(0)}%</td><td>${fmtMoney(r.revenue)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="mobile-row-list mobile-only">
      ${rows.map((r) => `
      <div class="ledger-mobile-card">
        <div class="name">${esc(r.name)}</div>
        <div class="chips">
          <span class="chip" style="background:var(--blue-soft);">${esc(r.category)}</span>
          ${r.setType ? `<span class="chip" style="background:var(--pink-soft);">${esc(r.setType)}</span>` : ""}
        </div>
        <div class="meta">Lifetime ${r.totalEntered} · Sold ${r.totalSold} · In stock <b style="color:var(--green);">${r.current}</b></div>
        <div class="meta">${r.percentSold.toFixed(0)}% sold · ${fmtMoney(r.revenue)} revenue</div>
      </div>`).join("")}
    </div>`}
  </div>`;
}

/* -------------------------------------------------------------------------
   14. Stats tab
   ------------------------------------------------------------------------- */
function renderStatsTabHTML() {
  const groupBy = state.ui.stats.groupBy;
  return `
  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:8px;">
      <h2 class="section-title" style="margin:0;">📊 Items sold</h2>
      <div class="stats-toggle-group">
        <button class="stats-toggle-btn ${groupBy === "name" ? "active" : ""}" data-action="set-stats-groupby" data-key="name">Item</button>
        <button class="stats-toggle-btn ${groupBy === "category" ? "active" : ""}" data-action="set-stats-groupby" data-key="category">Category</button>
        <button class="stats-toggle-btn ${groupBy === "setType" ? "active" : ""}" data-action="set-stats-groupby" data-key="setType">Set type</button>
      </div>
    </div>
    <div class="chart-wrap"><canvas id="pieChart1"></canvas></div>
    <div id="pieChart1Empty"></div>
  </div>

  <div class="stats-grid-2">
    <div class="card">
      <h2 class="section-title">🌸 Profit by item</h2>
      <p id="revenueTotalLine" style="font-size:12px; color:var(--ink-soft); margin:-6px 0 8px;"></p>
      <div class="chart-wrap"><canvas id="pieChart2"></canvas></div>
      <div id="pieChart2Empty"></div>
    </div>
    <div class="card">
      <h2 class="section-title">📊 Sales over time</h2>
      <div class="chart-wrap"><canvas id="barChart"></canvas></div>
      <div id="barChartEmpty"></div>
    </div>
  </div>`;
}
function mountStatsCharts() {
  const Chart = window.Chart;
  if (!Chart) return;
  const groupBy = state.ui.stats.groupBy;

  // Pie 1: units sold grouped by item / category / set type
  const map1 = new Map();
  state.soldTx.forEach((t) => {
    const key = groupBy === "name" ? t.name : groupBy === "category" ? (t.category || "Uncategorized") : (t.setType || "No set");
    map1.set(key, (map1.get(key) || 0) + (Number(t.quantity) || 0));
  });
  const pie1 = Array.from(map1.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Pie 2: revenue by item (only priced sales)
  const map2 = new Map();
  state.soldTx.forEach((t) => {
    const rev = (Number(t.quantity) || 0) * (Number(t.price) || 0);
    if (rev <= 0) return;
    map2.set(t.name, (map2.get(t.name) || 0) + rev);
  });
  const pie2 = Array.from(map2.entries()).map(([name, value]) => ({ name, value: Number(value.toFixed(2)) })).sort((a, b) => b.value - a.value);
  const totalRevenue = pie2.reduce((a, b) => a + b.value, 0);
  document.getElementById("revenueTotalLine").textContent = pie2.length ? `Total revenue: ${fmtMoney(totalRevenue)}` : "";

  // Bar: sales by month
  const map3 = new Map();
  state.soldTx.forEach((t) => { const key = monthKey(t.date); map3.set(key, (map3.get(key) || 0) + (Number(t.quantity) || 0)); });
  const barData = Array.from(map3.entries()).map(([month, qty]) => ({ month, qty })).sort((a, b) => a.month.localeCompare(b.month));

  if (charts.pie1) charts.pie1.destroy();
  if (charts.pie2) charts.pie2.destroy();
  if (charts.bar) charts.bar.destroy();

  const c1 = document.getElementById("pieChart1");
  const e1 = document.getElementById("pieChart1Empty");
  if (pie1.length === 0) { c1.style.display = "none"; e1.innerHTML = `<div class="empty-state">${DANDELION_SVG}<p>Sell something to see stats here!</p></div>`; }
  else {
    c1.style.display = "block"; e1.innerHTML = "";
    charts.pie1 = new Chart(c1.getContext("2d"), {
      type: "doughnut",
      data: { labels: pie1.map((d) => d.name), datasets: [{ data: pie1.map((d) => d.value), backgroundColor: CHART_COLORS }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { family: "Quicksand" } } } } },
    });
  }

  const c2 = document.getElementById("pieChart2");
  const e2 = document.getElementById("pieChart2Empty");
  if (pie2.length === 0) { c2.style.display = "none"; e2.innerHTML = `<div class="empty-state">${DANDELION_SVG}<p>Add prices when you sell items to see profit stats.</p></div>`; }
  else {
    c2.style.display = "block"; e2.innerHTML = "";
    charts.pie2 = new Chart(c2.getContext("2d"), {
      type: "pie",
      data: { labels: pie2.map((d) => d.name), datasets: [{ data: pie2.map((d) => d.value), backgroundColor: CHART_COLORS }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { family: "Quicksand" } } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtMoney(ctx.parsed)}` } } } },
    });
  }

  const c3 = document.getElementById("barChart");
  const e3 = document.getElementById("barChartEmpty");
  if (barData.length === 0) { c3.style.display = "none"; e3.innerHTML = `<div class="empty-state">${DANDELION_SVG}<p>Your sales timeline will show up here.</p></div>`; }
  else {
    c3.style.display = "block"; e3.innerHTML = "";
    charts.bar = new Chart(c3.getContext("2d"), {
      type: "bar",
      data: { labels: barData.map((d) => d.month), datasets: [{ label: "Units sold", data: barData.map((d) => d.qty), backgroundColor: "#5FA8D3", borderRadius: 8 }] },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } },
    });
  }
}

/* -------------------------------------------------------------------------
   15. Sets tab
   ------------------------------------------------------------------------- */
function renderSetsTabHTML() {
  return `
  <div class="card">
    <h2 class="section-title">🌸 Manage sets</h2>
    <p style="font-size:12px; color:var(--ink-soft); margin:-8px 0 16px;">Sets let you match jewelry across categories — e.g. "Spring Garden Set" could tie together an earring and a necklace entry.</p>
    <form data-action="create-set-form" style="display:flex; gap:8px; margin-bottom:20px;">
      <input class="input" id="bind-newSetName" placeholder="New set name, e.g. Spring Garden Set" data-bind="newSetName" value="${esc(state.ui.newSetName)}" />
      <button type="submit" class="btn btn-primary">➕ Create</button>
    </form>
    ${state.sets.length === 0 ? `<div class="empty-state">${DANDELION_SVG}<p>No sets yet — create your first one above.</p></div>` : `
    <div class="sets-wrap">
      ${state.sets.map((s) => `
      <div class="sets-chip">
        ${esc(s.name)}
        <button data-action="request-remove-set" data-id="${s.id}" data-name="${esc(s.name)}">✖️</button>
      </div>`).join("")}
    </div>`}
  </div>`;
}

/* -------------------------------------------------------------------------
   16. Friends tab
   ------------------------------------------------------------------------- */
function renderFriendsTabHTML() {
  const members = (state.group && state.group.members) || [];
  return `
  <div class="card">
    <h2 class="section-title">👯 Your shared inventory</h2>
    <p style="font-size:12px; color:var(--ink-soft); margin:-8px 0 16px;">Everyone listed here sees and edits the exact same Add Items, Live, Sold, Ledger, and Stats data.</p>
    <div class="member-list">
      ${members.map((m) => `
      <div class="member-row">
        <span>${esc(m.email)} ${state.user && m.uid === state.user.uid ? "<b>(you)</b>" : ""}</span>
      </div>`).join("")}
    </div>
    ${members.length > 1 ? `<div style="margin-top:14px;"><button class="btn btn-secondary" data-action="request-leave-group">Leave shared inventory</button></div>` : ""}
  </div>

  <div class="card">
    <h2 class="section-title">💌 Add a friend</h2>
    <p style="font-size:12px; color:var(--ink-soft); margin:-8px 0 16px;">Enter their email to invite them to share this inventory with you.</p>
    <form data-action="send-invite-form" style="display:flex; gap:8px;">
      <input class="input" id="bind-friendEmail" type="email" placeholder="friend@email.com" data-bind="friendEmail" value="${esc(state.ui.friendEmail)}" />
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
  </div>

  <div class="card">
    <h2 class="section-title">📤 Invites you've sent</h2>
    ${state.invitesSent.length === 0 ? `<p style="font-size:13px; color:var(--ink-soft);">No pending invites.</p>` : `
    <div class="invite-list">
      ${state.invitesSent.map((i) => `
      <div class="invite-row">
        <span>${esc(i.toEmail)}</span>
        <div class="actions"><button class="btn btn-ghost" data-action="cancel-invite" data-id="${i.id}">Cancel</button></div>
      </div>`).join("")}
    </div>`}
  </div>

  <div class="card">
    <h2 class="section-title">📥 Invites for you</h2>
    ${state.invitesReceived.length === 0 ? `<p style="font-size:13px; color:var(--ink-soft);">No invites right now.</p>` : `
    <div class="invite-list">
      ${state.invitesReceived.map((i) => `
      <div class="invite-row">
        <span>${esc(i.fromEmail)} wants to share their inventory with you</span>
        <div class="actions">
          <button class="btn btn-green" data-action="accept-invite" data-id="${i.id}">Accept</button>
          <button class="btn btn-ghost" data-action="decline-invite" data-id="${i.id}">Decline</button>
        </div>
      </div>`).join("")}
    </div>`}
  </div>`;
}

/* -------------------------------------------------------------------------
   17. Event delegation (attached once)
   ------------------------------------------------------------------------- */
function wireStaticListeners() {
  document.getElementById("googleSignInBtn").addEventListener("click", handleSignIn);
  document.getElementById("signOutBtn").addEventListener("click", handleSignOut);

  document.addEventListener("submit", async (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.action === "submit-entry-form") { e.preventDefault(); await addEntry(); }
    else if (t.dataset && t.dataset.action === "create-set-form") { e.preventDefault(); await createSet(); }
    else if (t.dataset && t.dataset.action === "send-invite-form") { e.preventDefault(); await sendInvite(); }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.action === "name-input") {
      setDeep(state.ui, "form.name", t.value);
      const match = distinctEntryOptions().find((o) => norm(o.name) === norm(t.value));
      if (match) {
        state.ui.form.category = match.category || state.ui.form.category;
        state.ui.form.setType = match.setType || "";
        state.ui.form.count = match.count || 1;
      }
      renderAll();
      return;
    }
    if (t.dataset.bind) { setDeep(state.ui, t.dataset.bind, t.value); renderAll(); }
  });

  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.action === "photo-upload") { await handlePhotoChange(t); }
  });

  document.addEventListener("click", async (e) => {
    // Click on the dimmed background (not any content inside the modal box) closes it.
    if (e.target.classList && e.target.classList.contains("modal-overlay")) {
      closeModal();
      return;
    }
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    const h = state.ui.hist;

    switch (action) {
      case "switch-tab":
        state.ui.activeTab = t.dataset.tab;
        renderAll();
        break;

      case "open-date-picker": {
        const el = document.getElementById(t.dataset.target);
        if (el && el.showPicker) { try { el.showPicker(); } catch (_) { el.focus(); } } else if (el) el.focus();
        break;
      }

      case "toggle-select-entry": {
        const id = t.dataset.id;
        if (h.selected[id]) delete h.selected[id]; else h.selected[id] = true;
        renderAll();
        break;
      }
      case "toggle-select-page": {
        const h2 = state.ui.hist;
        const filtered = state.entries
          .filter((e) => (h2.search ? norm(e.name).includes(norm(h2.search)) : true))
          .filter((e) => (h2.dateFrom ? e.date >= h2.dateFrom : true))
          .filter((e) => (h2.dateTo ? e.date <= h2.dateTo : true))
          .filter((e) => (h2.category ? e.category === h2.category : true))
          .filter((e) => (h2.setType ? e.setType === h2.setType : true))
          .sort((a, b) => b.createdAt - a.createdAt);
        const pageIds = filtered.slice(h2.page * 10, h2.page * 10 + 10).map((e) => e.id);
        const allSelected = pageIds.length > 0 && pageIds.every((id) => h2.selected[id]);
        pageIds.forEach((id) => { if (allSelected) delete h2.selected[id]; else h2.selected[id] = true; });
        renderAll();
        break;
      }
      case "request-delete-entry":
        openConfirmModal({
          title: "Remove this entry?", body: `This will permanently delete "${t.dataset.name}".`,
          onConfirm: async () => { await deleteEntry(t.dataset.id); showToast("Entry removed."); },
        });
        break;
      case "request-delete-many": {
        const ids = Object.keys(h.selected).filter((id) => h.selected[id]);
        openConfirmModal({
          title: "Remove these entries?", body: `This will permanently delete ${ids.length} selected entries.`,
          onConfirm: async () => { await deleteManyEntries(ids); state.ui.hist.selected = {}; showToast("Entries removed."); },
        });
        break;
      }
      case "prev-page": state.ui.hist.page = Math.max(0, state.ui.hist.page - 1); renderAll(); break;
      case "next-page": state.ui.hist.page += 1; renderAll(); break;

      case "modal-cancel": closeModal(); break;
      case "modal-confirm": await handleModalConfirm(); break;

      case "open-item-modal": openQuantityModal(t.dataset.mode, t.dataset.key); break;
      case "quantity-confirm": await handleQuantityConfirm(); break;

      case "open-export": openExportModal(t.dataset.mode, t.dataset.mode === "live" ? getLiveItems() : getSoldItems()); break;
      case "toggle-export-field": { const m = state.ui.modal; m.fields[t.dataset.key] = !m.fields[t.dataset.key]; renderAll(); break; }
      case "move-export-field-up": {
        const m = state.ui.modal; const key = t.dataset.key;
        const idx = m.fieldOrder.indexOf(key);
        if (idx > 0) { [m.fieldOrder[idx - 1], m.fieldOrder[idx]] = [m.fieldOrder[idx], m.fieldOrder[idx - 1]]; renderAll(); }
        break;
      }
      case "move-export-field-down": {
        const m = state.ui.modal; const key = t.dataset.key;
        const idx = m.fieldOrder.indexOf(key);
        if (idx !== -1 && idx < m.fieldOrder.length - 1) { [m.fieldOrder[idx + 1], m.fieldOrder[idx]] = [m.fieldOrder[idx], m.fieldOrder[idx + 1]]; renderAll(); }
        break;
      }
      case "toggle-export-cat": { const m = state.ui.modal; m.cats[t.dataset.key] = !m.cats[t.dataset.key]; renderAll(); break; }
      case "toggle-export-settype": { const m = state.ui.modal; m.setTypes[t.dataset.key] = !m.setTypes[t.dataset.key]; renderAll(); break; }
      case "toggle-all-export-fields": { const m = state.ui.modal; const all = Object.values(m.fields).every(Boolean); Object.keys(m.fields).forEach((k) => (m.fields[k] = !all)); renderAll(); break; }
      case "toggle-all-export-cats": { const m = state.ui.modal; const all = Object.values(m.cats).every(Boolean); Object.keys(m.cats).forEach((k) => (m.cats[k] = !all)); renderAll(); break; }
      case "toggle-all-export-settypes": { const m = state.ui.modal; const all = Object.values(m.setTypes).every(Boolean); Object.keys(m.setTypes).forEach((k) => (m.setTypes[k] = !all)); renderAll(); break; }
      case "do-export": doExport(); break;

      case "sort-ledger": {
        const key = t.dataset.key;
        if (state.ui.ledger.sortKey === key) state.ui.ledger.sortDir *= -1;
        else { state.ui.ledger.sortKey = key; state.ui.ledger.sortDir = 1; }
        renderAll();
        break;
      }
      case "set-stats-groupby": state.ui.stats.groupBy = t.dataset.key; renderAll(); break;

      case "request-remove-set":
        openConfirmModal({
          title: "Remove this set?", body: `"${t.dataset.name}" will no longer appear as an option when adding items. Existing entries keep their set label.`,
          onConfirm: async () => { await removeSet(t.dataset.id); },
        });
        break;

      case "cancel-invite": await cancelInvite(t.dataset.id); break;
      case "decline-invite": await declineInvite(t.dataset.id); break;
      case "accept-invite": {
        const invite = state.invitesReceived.find((i) => i.id === t.dataset.id);
        if (invite) await acceptInvite(invite);
        break;
      }
      case "request-leave-group":
        openConfirmModal({
          title: "Leave shared inventory?", confirmLabel: "Leave",
          body: "Items you personally added will move with you into a fresh, private inventory. Shared items stay with the rest of the group.",
          onConfirm: async () => { await leaveGroup(); },
        });
        break;
    }
  });
}

/* -------------------------------------------------------------------------
   18. Boot
   ------------------------------------------------------------------------- */
function init() {
  wireStaticListeners();
  if (!firebaseConfigured) {
    document.getElementById("configWarning").classList.remove("hidden");
    document.getElementById("googleSignInBtn").disabled = true;
    document.getElementById("signedOutScreen").classList.remove("hidden");
    return;
  }
  onAuthStateChanged(auth, handleAuthChange);
}
init();
