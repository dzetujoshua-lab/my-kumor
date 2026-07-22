// ═══════════════════════════════════════════════════════════════════
//  KUMO.JS — DTI Admin Dashboard Logic  (Firestore Live Edition)
//  Firebase v10 ES Modules · Cloud Firestore · Web Speech API
//  All hardcoded mock data removed. All state is driven by Firestore.
// ═══════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// ─── FIREBASE INIT ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB6xOvULN2NfdQ0s76ElriPBe7QlPXucZw",
  authDomain: "kumora-data.firebaseapp.com",
  projectId: "kumora-data",
  storageBucket: "kumora-data.firebasestorage.app",
  messagingSenderId: "405150896558",
  appId: "1:405150896558:web:36edfa874933abdad5b83f",
  measurementId: "G-6EQBTQCHF3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// FCM Setup
let messaging = null;
async function setupFCM() {
  try {
    const supported = await isSupported();
    if (supported) {
      messaging = getMessaging(app);
      onMessage(messaging, (payload) => {
        console.log("FCM foreground notification received in Admin:", payload);
        const title = payload.notification?.title || "Campus Alert";
        const body = payload.notification?.body || "New alert broadcast received.";
        showToast(`🔔 FCM Push Alert: ${title} - ${body}`, "gold");
        if (typeof speak === "function") speak(`Alert: ${title}. ${body}`);
      });
    }
  } catch (err) {
    console.warn("FCM setup notice:", err);
  }
}
setupFCM();


const isFrame = window.self !== window.top;

// Auth guard: redirect non-admins to login
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (!isFrame) {
      window.location.href = "login-admin.html";
    }
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  const role = snap.exists() ? snap.data().role : "user";
  if (role !== "admin") {
    if (!isFrame) {
      window.location.href = "login-admin.html";
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL MUTABLE STATE  —  all arrays start empty; Firestore fills them
// ═══════════════════════════════════════════════════════════════════
let CAMPUSES = []; // { id, name, icon, users, coords }
let inventoryData = []; // { id, itemName, category, quantity, status, emoji?, price?, imageUrl? }
let ANNOUNCEMENTS = []; // { id, title, content, date, author, tag, views }
let LOGS = []; // { id, type, text, color, time, createdAt }
let alertHistory = []; // { id, type, time, color }
let USERS = []; // driven by Firestore "users" collection
let ORDERS = []; // local-only; no Firestore collection for orders yet
let PRODUCTS = []; // mirrors inventoryData for inventory page rendering

// Unsubscribe handles for real-time listeners
let _unsubInventory = null;
let _unsubAnnouncements = null;
let _unsubLogs = null;
let _unsubAlerts = null;
let _unsubCampuses = null;
let _unsubUsers = null;

// ─── APP STATE ───────────────────────────────────────────────────
let currentAlertType = "";
let currentOrderFilter = "all";
let currentUserRoleFilter = "all";
let voiceOn = true;
let map;
let liveCounterInterval;
let _pendingConfirmCallback = null;

// ═══════════════════════════════════════════════════════════════════
//  VOICE AGENT — Web Speech API
// ═══════════════════════════════════════════════════════════════════
function speak(message) {
  if (!voiceOn) return;
  if (!window.speechSynthesis) return;
  // Cancel any in-progress utterance so we don't queue up
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  // Prefer a natural-sounding voice when available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) =>
      v.name.includes("Google") ||
      v.name.includes("Samantha") ||
      v.name.includes("Karen"),
  );
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

window.toggleVoice = function () {
  voiceOn = !voiceOn;
  const dot = document.getElementById("voiceDot");
  const label = document.getElementById("voiceLabel");
  if (dot) {
    dot.style.background = voiceOn ? "var(--gold)" : "var(--dim)";
    dot.style.animation = voiceOn ? "" : "none";
  }
  if (label) label.textContent = "Voice Agent: " + (voiceOn ? "ON" : "OFF");
  showToast(
    "Voice agent " + (voiceOn ? "activated" : "deactivated"),
    voiceOn ? "gold" : "",
  );
  if (voiceOn)
    speak(
      "Voice assistant reactivated. All admin confirmations will be announced.",
    );
};

// ═══════════════════════════════════════════════════════════════════
//  FIRESTORE — REAL-TIME LISTENERS
// ═══════════════════════════════════════════════════════════════════

// ── Campuses ──────────────────────────────────────────────────────
function subscribeCampuses() {
  console.log("[DTI] 🔄 Subscribing to campuses collection...");
  _unsubCampuses = onSnapshot(
    collection(db, "campuses"),
    (snapshot) => {
      CAMPUSES = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        CAMPUSES.push({
          id: docSnap.id,
          name: d.name || docSnap.id,
          icon: d.icon || "📍",
          users: typeof d.users === "number" ? d.users : 0,
          coords:
            Array.isArray(d.coords) && d.coords.length === 2
              ? d.coords
              : [5.655, -0.163],
        });
      });
      console.log(`[DTI] ✅ Campuses live: ${CAMPUSES.length} campus(es)`);
      // Re-render map and footer after live update
      if (map) {
        map.eachLayer((layer) => {
          if (layer instanceof L.Marker) map.removeLayer(layer);
        });
        renderMapMarkers();
      } else {
        initMap();
      }
      renderMapFooter();
      updateTotalUsersStat();
    },
    (error) => {
      console.error("[DTI] ❌ Campuses listener error:", error);
    },
  );
}

// ── Inventory ─────────────────────────────────────────────────────
function subscribeInventory() {
  console.log("[DTI] 🔄 Subscribing to inventory collection...");
  _unsubInventory = onSnapshot(
    collection(db, "inventory"),
    (snapshot) => {
      inventoryData = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        inventoryData.push({
          id: docSnap.id,
          itemName: d.itemName || "—",
          category: d.category || "general",
          quantity: typeof d.quantity === "number" ? d.quantity : 0,
          status: d.status || deriveStatus(d.quantity),
          emoji: d.emoji || categoryEmoji(d.category),
          price: typeof d.price === "number" ? d.price : 0,
          imageUrl: d.imageUrl || "",
        });
      });
      // Mirror into PRODUCTS so existing render functions still work
      PRODUCTS = inventoryData.map((item) => ({
        id: item.id,
        name: item.itemName,
        cat: item.category,
        emoji: item.emoji,
        stock: item.quantity,
        price: item.price,
        status: item.status,
        imageUrl: item.imageUrl || "",
      }));
      console.log(`[DTI] ✅ Inventory live: ${inventoryData.length} item(s)`);
      renderInventory();
      renderMarketSummary();
    },
    (error) => {
      console.error("[DTI] ❌ Inventory listener error:", error);
    },
  );
}

// ── Announcements ─────────────────────────────────────────────────
function subscribeAnnouncements() {
  console.log("[DTI] 🔄 Subscribing to announcements collection...");
  const q = query(collection(db, "announcements"), orderBy("date", "desc"));
  _unsubAnnouncements = onSnapshot(
    q,
    (snapshot) => {
      ANNOUNCEMENTS = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        ANNOUNCEMENTS.push({
          id: docSnap.id,
          title: d.title || "Untitled",
          content: d.content || d.body || "",
          date: d.date,
          author: d.author || "Admin",
          tag: d.tag || "info",
          views: typeof d.views === "number" ? d.views : 0,
        });
      });
      console.log(`[DTI] ✅ Announcements live: ${ANNOUNCEMENTS.length}`);
      renderAnnouncements();
      renderAnalytics();
      updateAnnouncementBadge();
    },
    (error) => {
      console.error("[DTI] ❌ Announcements listener error:", error);
    },
  );
}

// ── Activity Log ──────────────────────────────────────────────────
function subscribeActivityLog() {
  console.log("[DTI] 🔄 Subscribing to activity_log collection...");
  const q = query(
    collection(db, "activity_log"),
    orderBy("createdAt", "desc"),
    limit(60),
  );
  _unsubLogs = onSnapshot(
    q,
    (snapshot) => {
      LOGS = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        LOGS.push({
          id: docSnap.id,
          type: d.type || "admin",
          text: d.text || "",
          color: d.color || "slate",
          time: formatTimestamp(d.createdAt),
          createdAt: d.createdAt,
        });
      });
      console.log(`[DTI] ✅ Activity log live: ${LOGS.length} entries`);
      renderActivityLog();
      renderFullLog();
    },
    (error) => {
      console.error("[DTI] ❌ Activity log listener error:", error);
    },
  );
}

// ── Alerts ────────────────────────────────────────────────────────
function subscribeAlerts() {
  console.log("[DTI] 🔄 Subscribing to alerts collection...");
  const q = query(
    collection(db, "alerts"),
    orderBy("createdAt", "desc"),
    limit(20),
  );
  _unsubAlerts = onSnapshot(
    q,
    (snapshot) => {
      alertHistory = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        alertHistory.push({
          id: docSnap.id,
          type: d.type || "Unknown Alert",
          time: formatTimestamp(d.createdAt),
          color: d.color || "wine",
        });
      });
      console.log(`[DTI] ✅ Alerts live: ${alertHistory.length} entries`);
      renderAlertLog();
    },
    (error) => {
      console.error("[DTI] ❌ Alerts listener error:", error);
    },
  );
}

// ── Users ─────────────────────────────────────────────────────────
function subscribeUsers() {
  console.log("[DTI] 🔄 Subscribing to users collection...");
  _unsubUsers = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      USERS = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const name = d.name || d.displayName || "Unknown";
        const initials = (d.initials || name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase());
        USERS.push({
          id: docSnap.id,
          name,
          email: d.email || "—",
          role: d.role || "visitor",
          campus: d.campus || "Main Campus",
          status: d.status || "active",
          verified: typeof d.verified === "boolean" ? d.verified : true,
          joined: d.joined || formatTimestamp(d.createdAt),
          initials,
        });
      });
      console.log(`[DTI] ✅ Users live: ${USERS.length} user(s)`);
      renderUsers();
      renderPendingStaff();
      const statEl = document.getElementById("stat-users");
      if (statEl) statEl.textContent = USERS.length;
    },
    (error) => {
      console.error("[DTI] ❌ Users listener error:", error);
    },
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CUSTOM CONFIRM DIALOG  (replaces native window.confirm)
// ═══════════════════════════════════════════════════════════════════
function showConfirm(title, message, onConfirm) {
  const overlay = document.getElementById("confirmModal");
  const titleEl = document.getElementById("confirmModal-title");
  const msgEl = document.getElementById("confirmModal-msg");
  const okBtn = document.getElementById("confirmModal-ok");
  if (!overlay || !titleEl || !msgEl || !okBtn) {
    // fallback
    if (window.confirm(message)) onConfirm();
    return;
  }
  titleEl.textContent = title;
  msgEl.textContent = message;
  _pendingConfirmCallback = onConfirm;
  // Remove old listener to prevent duplicates
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.addEventListener("click", () => {
    closeModal("confirmModal");
    if (_pendingConfirmCallback) _pendingConfirmCallback();
    _pendingConfirmCallback = null;
  });
  overlay.classList.add("open");
}

// ═══════════════════════════════════════════════════════════════════
//  FIRESTORE — WRITE HELPERS
// ═══════════════════════════════════════════════════════════════════

// Write a log entry to Firestore (addDoc) — this triggers the onSnapshot
async function writeLog(type, text, color) {
  try {
    await addDoc(collection(db, "activity_log"), {
      type,
      text,
      color,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("[DTI] ❌ Failed to write log entry:", err);
    // Fallback: update local array so UI isn't broken
    LOGS.unshift({ type, text, color, time: "Just now" });
    renderActivityLog();
    renderFullLog();
  }
}

// Public addLog — writes to Firestore (real-time listener updates UI)
window.addLog = function (type, text, color) {
  writeLog(type, text, color);
};
function addLog(type, text, color) {
  window.addLog(type, text, color);
}

// Write alert to Firestore
async function writeAlert(type, color) {
  try {
    await addDoc(collection(db, "alerts"), {
      type,
      color,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("[DTI] ❌ Failed to write alert:", err);
    alertHistory.unshift({ type, time: "Just now", color });
    renderAlertLog();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BOOTSTRAP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", async () => {
  console.log("[DTI] 🚀 Bootstrapping dashboard...");

  // 1. Start all real-time Firestore listeners — UI re-renders automatically
  subscribeCampuses();
  subscribeInventory();
  subscribeAnnouncements();
  subscribeActivityLog();
  subscribeAlerts();
  subscribeUsers();

  // 2. Render static / local components immediately
  renderOrders();
  renderUsers();
  renderAlertLog();

  // 3. Animate stat card values on load
  animateStatCards();

  // 4. Start live user counter (fires every 5 s, based on live CAMPUSES data)
  startLiveCounter();

  console.log("[DTI] ✅ Dashboard bootstrap complete.");
});

// ─── AUTH STATE OBSERVER ─────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    const displayName =
      user.displayName || user.email?.split("@")[0] || "Admin";
    const initials = displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    document
      .querySelectorAll(".sb-admin-name, .tb-profile-name")
      .forEach((el) => (el.textContent = displayName));
    document
      .querySelectorAll(".sb-avatar, .tb-profile-avatar")
      .forEach((el) => (el.textContent = initials));
    document
      .querySelectorAll(".sb-admin-role")
      .forEach((el) => (el.textContent = "Super Administrator"));
    const sNameEl = document.getElementById("settings-admin-name");
    const sEmailEl = document.getElementById("settings-admin-email");
    if (sNameEl) sNameEl.textContent = displayName;
    if (sEmailEl) sEmailEl.textContent = user.email;
  }
});

// ─── Modal overlay close-on-backdrop ─────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".modal-overlay").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m) m.classList.remove("open");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════
function deriveStatus(qty) {
  if (qty === 0 || qty == null) return "out";
  if (qty < 8) return "low";
  return "ok";
}

function categoryEmoji(cat) {
  const map = {
    food: "🍲",
    stationery: "📓",
    electronics: "💻",
    clothing: "👕",
  };
  return map[(cat || "").toLowerCase()] || "📦";
}

function formatTimestamp(ts) {
  if (!ts) return "Just now";
  try {
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000); // seconds ago
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch (_) {
    return "Just now";
  }
}

function animateStatCards() {
  document.querySelectorAll(".stat-value").forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(
      () => {
        el.style.transition = "opacity .4s ease, transform .4s ease";
        el.style.opacity = "1";
        el.style.transform = "none";
      },
      200 + Math.random() * 300,
    );
  });
}

function updateTotalUsersStat() {
  const total = CAMPUSES.reduce((s, c) => s + c.users, 0);
  const statEl = document.getElementById("stat-users");
  if (statEl) statEl.textContent = total || "0";
}

function updateAnnouncementBadge() {
  // Update nav badge for announcements count
  const badges = document.querySelectorAll(".nav-item");
  badges.forEach((btn) => {
    if (btn.textContent.includes("Announcements")) {
      let badge = btn.querySelector(".nav-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-badge";
        btn.appendChild(badge);
      }
      badge.textContent = ANNOUNCEMENTS.length;
    }
  });
  // Update stat-views with total views
  const totalViews = ANNOUNCEMENTS.reduce((s, a) => s + (a.views || 0), 0);
  const statEl = document.getElementById("stat-views");
  if (statEl) statEl.textContent = totalViews.toLocaleString();
}

// ═══════════════════════════════════════════════════════════════════
//  MAP
// ═══════════════════════════════════════════════════════════════════
function initMap() {
  const mapEl = document.getElementById("campus-map");
  if (!mapEl || map) return; // already initialised

  map = L.map("campus-map", {
    center: [5.655, -0.163],
    zoom: 14.5,
    zoomControl: false,
    scrollWheelZoom: false,
    attributionControl: false,
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 19,
    },
  ).addTo(map);

  renderMapMarkers();
  renderMapFooter();
  updateTotalUsersStat();
}

function renderMapMarkers() {
  if (!map) return;
  // Remove existing markers only (keep tile layer)
  map.eachLayer((layer) => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  if (CAMPUSES.length === 0) return;

  CAMPUSES.forEach((c) => {
    const col = c.users > 30 ? "#722F37" : c.users > 15 ? "#C5A059" : "#555";
    const size = Math.max(32, Math.min(52, 28 + c.users / 2));
    const html = `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${col};color:#fff;border:2.5px solid #fff;
      box-shadow:0 3px 12px rgba(0,0,0,.25);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'DM Sans',sans-serif;font-size:${size > 40 ? 11 : 9}px;font-weight:700;
      cursor:pointer;transition:transform .15s;
    " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
      <span style="font-size:${size > 40 ? 13 : 11}px">${c.icon}</span>
      <span>${c.users}</span>
    </div>`;
    const icon = L.divIcon({
      html,
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    L.marker(c.coords, { icon })
      .addTo(map)
      .bindPopup(`<b>${c.name}</b><br>👥 ${c.users} logged-in users`, {
        closeButton: false,
      });
  });
}

function renderMapFooter() {
  const footer = document.getElementById("mapFooter");
  if (!footer) return;
  if (CAMPUSES.length === 0) {
    footer.innerHTML =
      '<div style="font-size:11.5px;color:var(--muted);padding:4px 0">No campus data loaded yet.</div>';
    return;
  }
  footer.innerHTML = CAMPUSES.map(
    (c) => `
    <div class="campus-user-chip">
      <span class="cuc-dot" style="background:${c.users > 30 ? "var(--wine)" : c.users > 15 ? "var(--gold)" : "var(--dim)"}"></span>
      ${c.icon} ${c.name.replace(" Campus", "").replace(" Hostel", "")}: <strong style="margin-left:3px">${c.users}</strong>
    </div>
  `,
  ).join("");
}

function startLiveCounter() {
  if (liveCounterInterval) clearInterval(liveCounterInterval);
  liveCounterInterval = setInterval(() => {
    if (!CAMPUSES.length) return;
    CAMPUSES.forEach((c) => {
      const delta = Math.floor(Math.random() * 3) - 1;
      c.users = Math.max(1, c.users + delta);
    });
    renderMapFooter();
    updateTotalUsersStat();
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════
window.navigate = function (page, btn) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  const el = document.getElementById("page-" + page);
  if (el) el.classList.add("active");
  if (btn) btn.classList.add("active");
  const crumb = document.getElementById("breadcrumb");
  if (crumb)
    crumb.innerHTML =
      "<span>" + (btn ? btn.textContent.trim() : page) + "</span>";
  if (page === "dashboard" && map) setTimeout(() => map.invalidateSize(), 200);
};

// ═══════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════
window.showToast = function (msg, type = "") {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML =
    (type === "success"
      ? "✅ "
      : type === "error"
        ? "❌ "
        : type === "gold"
          ? "⭐ "
          : "ℹ️ ") + msg;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 300);
  }, 3000);
};

// ═══════════════════════════════════════════════════════════════════
//  ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════
window.renderAnnouncements = function () {
  const el = document.getElementById("ann-published");
  if (!el) return;
  if (ANNOUNCEMENTS.length === 0) {
    el.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No announcements yet. Publish one above.</div>';
    return;
  }
  el.innerHTML = ANNOUNCEMENTS.map(
    (a) => `
    <div class="ann-item">
      <div class="ann-item-header">
        <span class="ann-tag ${a.tag || "info"}">${a.tag === "urgent" ? "🔴 Urgent" : a.tag === "event" ? "🎉 Event" : "📢 Info"}</span>
        <span class="ann-views">👁 ${(a.views || 0).toLocaleString()}</span>
        <span class="ann-time">${formatTimestamp(a.date)}</span>
      </div>
      <div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:4px">${a.title}</div>
      <div class="ann-text">${a.content}</div>
      <div style="display:flex;gap:7px;margin-top:9px;align-items:center">
        <span style="font-size:10.5px;color:var(--muted)">By ${a.author || "Admin"}</span>
        <button class="icon-btn del" onclick="deleteAnn('${a.id}')">🗑</button>
      </div>
    </div>
  `,
  ).join("");
};
function renderAnnouncements() {
  window.renderAnnouncements();
}

window.publishAnnouncement = async function () {
  const titleEl = document.getElementById("ann-title");
  const bodyEl = document.getElementById("ann-body");
  const tagEl = document.getElementById("ann-tag");
  const title = titleEl?.value.trim();
  const content = bodyEl?.value.trim();
  const tag = tagEl?.value || "info";

  if (!title || !content) {
    showToast("Please fill title and body", "error");
    return;
  }

  const currentUser = auth.currentUser;
  const author =
    currentUser?.displayName || currentUser?.email?.split("@")[0] || "Admin";

  try {
    await addDoc(collection(db, "announcements"), {
      title,
      content,
      tag,
      author,
      views: 0,
      date: serverTimestamp(),
    });

    // Clear form
    if (titleEl) titleEl.value = "";
    if (bodyEl) bodyEl.value = "";
    const preview = document.getElementById("drop-preview");
    if (preview) preview.style.display = "none";

    showToast(`"${title}" published to all users`, "success");
    addLog(
      "admin",
      `<strong>Announcement</strong> "${title}" published`,
      "wine",
    );
    speak(
      `System update complete. The new campus announcement has been securely synchronized with the central database.`,
    );
  } catch (err) {
    console.error("[DTI] ❌ Failed to publish announcement:", err);
    showToast("Failed to publish: " + err.message, "error");
  }
};

window.deleteAnn = function (id) {
  showConfirm(
    "Delete Announcement",
    "Are you sure you want to delete this announcement? This cannot be undone.",
    async () => {
      try {
        await deleteDoc(doc(db, "announcements", id));
        showToast("Announcement deleted", "error");
        addLog("admin", `<strong>Announcement</strong> deleted`, "wine");
      } catch (err) {
        console.error("[DTI] ❌ Failed to delete announcement:", err);
        showToast("Delete failed: " + err.message, "error");
      }
    }
  );
};

// ─── IMAGE DROP ───────────────────────────────────────────────────
window.handleImageSelect = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = document.getElementById("drop-preview");
    if (preview) {
      preview.src = ev.target.result;
      preview.style.display = "block";
    }
  };
  reader.readAsDataURL(file);
};

window.handleDrop = function (e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please drop an image file", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = document.getElementById("drop-preview");
    if (preview) {
      preview.src = ev.target.result;
      preview.style.display = "block";
    }
  };
  reader.readAsDataURL(file);
};

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS  (reads from live ANNOUNCEMENTS + PRODUCTS state)
// ═══════════════════════════════════════════════════════════════════
function renderAnalytics() {
  const el = document.getElementById("ann-analytics");
  if (!el) return;

  if (ANNOUNCEMENTS.length === 0) {
    el.innerHTML =
      '<div style="font-size:11.5px;color:var(--muted)">No announcement data yet.</div>';
    const chart = document.getElementById("viewChart");
    if (chart) chart.innerHTML = "";
    return;
  }

  const maxViews = Math.max(...ANNOUNCEMENTS.map((a) => a.views || 0), 1);
  const top = ANNOUNCEMENTS.slice(0, 4);

  el.innerHTML = top
    .map((a) => {
      const pct = Math.round(((a.views || 0) / maxViews) * 100);
      return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:11.5px;font-weight:600;color:var(--ink2)">${a.title}</span>
          <span style="font-size:11px;font-weight:700;color:var(--gold-dk)">${(a.views || 0).toLocaleString()} views</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--wine),var(--gold))"></div>
        </div>
      </div>
    `;
    })
    .join("");

  // Sparkline chart — generate pseudo-daily data from views
  const chart = document.getElementById("viewChart");
  if (!chart) return;
  const totalViews = ANNOUNCEMENTS.reduce((s, a) => s + (a.views || 0), 0);
  const base = Math.max(Math.floor(totalViews / 14), 10);
  const data = Array.from(
    { length: 7 },
    (_, i) =>
      base +
      Math.floor(Math.random() * base * 0.4) +
      i * Math.floor(base * 0.05),
  );
  const max = Math.max(...data);
  chart.innerHTML = data
    .map(
      (v, i) => `
    <div class="mc-bar" style="height:${(v / max) * 100}%;background:${i === 6 ? "var(--wine)" : "var(--ash3)"};" title="${v} views"></div>
  `,
    )
    .join("");
}

function renderMarketSummary() {
  const el = document.getElementById("market-summary");
  if (!el) return;

  if (PRODUCTS.length === 0) {
    el.innerHTML =
      '<div style="font-size:11.5px;color:var(--muted)">No products in inventory yet.</div>';
    return;
  }

  const catCounts = {};
  PRODUCTS.forEach((p) => {
    const c = (p.cat || "other").toLowerCase();
    catCounts[c] = (catCounts[c] || 0) + 1;
  });
  const total = PRODUCTS.length || 1;
  const colorMap = {
    stationery: "var(--ink2)",
    food: "var(--gold)",
    clothing: "var(--wine)",
    electronics: "var(--muted)",
  };
  const rows = Object.entries(catCounts).map(([name, count]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    count,
    pct: Math.round((count / total) * 100),
    color: colorMap[name] || "var(--slate)",
  }));

  el.innerHTML = rows
    .map(
      (c) => `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:12px;font-weight:600;color:var(--ink2)">${c.name}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:var(--muted)">${c.count} items</span>
          <span style="font-size:11px;font-weight:700;color:${c.color}">${c.pct}%</span>
        </div>
      </div>
      <div class="progress-wrap">
        <div class="progress-fill" style="width:${c.pct}%;background:${c.color}"></div>
      </div>
    </div>
  `,
    )
    .join("");

  // Update the stat-products badge
  const statEl = document.getElementById("stat-products");
  if (statEl) statEl.textContent = PRODUCTS.length;
}

// ═══════════════════════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════════════════════
window.renderInventory = function (cat) {
  const tbody = document.getElementById("inventory-tbody");
  if (!tbody) return;

  const data = cat ? PRODUCTS.filter((p) => p.cat === cat) : PRODUCTS;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted);font-size:12px">
      No inventory items found. Add products to the Firestore "inventory" collection.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (p) => `
    <tr>
      <td>
        <div class="product-name-cell">
          ${p.imageUrl
            ? `<img src="${p.imageUrl}" class="product-img" alt="${p.name}" style="object-fit:cover;border-radius:var(--r-sm);width:36px;height:36px;border:1px solid var(--ash3)" onerror="this.outerHTML='<div class=\\'product-img\\'>${p.emoji || "📦"}</div>'">`
            : `<div class="product-img">${p.emoji || "📦"}</div>`}
          <div>
            <div class="product-name">${p.name}</div>
            <div class="product-cat">${p.id}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="role-badge ${p.cat === "food" ? "student" : p.cat === "electronics" ? "admin" : p.cat === "clothing" ? "staff" : "visitor"}" style="text-transform:capitalize">${p.cat || "—"}</span>
      </td>
      <td>
        <input class="inline-edit" type="number" value="${p.stock}" min="0"
          onchange="updateStock('${p.id}', this.value)" style="width:65px">
        <span class="stock-badge ${p.status}" style="margin-left:5px">${p.status === "ok" ? "OK" : p.status === "low" ? "Low" : "Out"}</span>
      </td>
      <td>
        <input class="inline-edit" type="number" value="${(p.price || 0).toFixed(2)}" min="0" step="0.50"
          onchange="updatePrice('${p.id}', this.value)" style="width:75px">
      </td>
      <td>
        <span style="font-size:11px;font-weight:600;color:${p.status === "ok" ? "#1a9e50" : p.status === "low" ? "var(--gold-dk)" : "var(--wine)"}">
          ${p.status === "ok" ? "● In Stock" : p.status === "low" ? "⚠ Low Stock" : "✕ Out of Stock"}
        </span>
      </td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="icon-btn save" onclick="saveInventoryItem('${p.id}')">💾</button>
          <button class="icon-btn del"  onclick="deleteInventoryItem('${p.id}', '${p.name}')">🗑</button>
        </div>
      </td>
    </tr>
  `,
    )
    .join("");
};
function renderInventory(cat) {
  window.renderInventory(cat);
}

window.filterInventory = function (cat, btn) {
  document
    .querySelectorAll("#page-inventory .chip")
    .forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderInventory(cat === "all" ? null : cat);
};

// Update stock locally + write to Firestore
window.updateStock = async function (id, val) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  p.stock = parseInt(val);
  p.status = deriveStatus(p.stock);
  // Mirror back into inventoryData
  const inv = inventoryData.find((x) => x.id === id);
  if (inv) {
    inv.quantity = p.stock;
    inv.status = p.status;
  }
};

window.updatePrice = async function (id, val) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  p.price = parseFloat(val);
  const inv = inventoryData.find((x) => x.id === id);
  if (inv) inv.price = p.price;
};

// Save button — commits row to Firestore
window.saveInventoryItem = async function (id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  try {
    await updateDoc(doc(db, "inventory", id), {
      quantity: p.stock,
      status: deriveStatus(p.stock),
      price: p.price,
    });
    showToast(`${p.name} saved to database`, "success");
    addLog(
      "admin",
      `<strong>Inventory updated</strong> — ${p.name} stock set to ${p.stock}`,
      "gold",
    );
    speak(
      `System update applied. Inventory stock modifications have been synchronized with the cloud database.`,
    );
  } catch (err) {
    console.error("[DTI] ❌ Failed to save inventory item:", err);
    showToast("Save failed: " + err.message, "error");
  }
};

window.deleteInventoryItem = function (id, name) {
  showConfirm(
    "Remove Inventory Item",
    `Remove "${name}" from inventory? This action cannot be undone.`,
    async () => {
      try {
        await deleteDoc(doc(db, "inventory", id));
        showToast(`${name} removed from inventory`, "error");
        addLog(
          "admin",
          `<strong>Inventory item</strong> "${name}" deleted`,
          "wine",
        );
      } catch (err) {
        console.error("[DTI] ❌ Failed to delete inventory item:", err);
        showToast("Delete failed: " + err.message, "error");
      }
    }
  );
};

window.addInventoryItem = async function () {
  const nameEl = document.getElementById("new-item-name");
  const catEl = document.getElementById("new-item-cat");
  const qtyEl = document.getElementById("new-item-qty");
  const imgEl = document.getElementById("inv-image-url");

  const itemName = nameEl?.value.trim();
  const category = catEl?.value || "general";
  const quantity = parseInt(qtyEl?.value || "0");
  const imageUrl = imgEl?.value.trim() || "";

  if (!itemName) {
    showToast("Please enter an item name", "error");
    return;
  }

  try {
    await addDoc(collection(db, "inventory"), {
      itemName,
      category,
      quantity,
      status: deriveStatus(quantity),
      emoji: categoryEmoji(category),
      price: 0,
      imageUrl,
      createdAt: serverTimestamp(),
    });
    showToast(`${itemName} added to inventory`, "success");
    addLog(
      "admin",
      `<strong>New item</strong> "${itemName}" added to inventory`,
      "gold",
    );
    speak(
      `System update applied. Inventory stock modifications have been synchronized with the cloud database.`,
    );
    if (nameEl) nameEl.value = "";
    if (qtyEl) qtyEl.value = "";
    if (imgEl) imgEl.value = "";
  } catch (err) {
    console.error("[DTI] ❌ Failed to add inventory item:", err);
    showToast("Failed to add item: " + err.message, "error");
  }
};

// ═══════════════════════════════════════════════════════════════════
//  ACTIVITY LOG RENDERING
// ═══════════════════════════════════════════════════════════════════
function renderActivityLog() {
  const el = document.getElementById("activity-log");
  if (!el) return;
  if (LOGS.length === 0) {
    el.innerHTML =
      '<div class="log-item"><div class="log-text" style="color:var(--muted)">No activity logged yet.</div></div>';
    return;
  }
  el.innerHTML = LOGS.slice(0, 8)
    .map(
      (l) => `
    <div class="log-item">
      <div class="log-dot-wrap"><div class="log-dot ${l.color}"></div></div>
      <div class="log-text">${l.text}</div>
      <div class="log-time">${l.time}</div>
    </div>
  `,
    )
    .join("");
}

window.renderFullLog = function () {
  const el = document.getElementById("full-log");
  if (!el) return;
  if (LOGS.length === 0) {
    el.innerHTML =
      '<div class="log-item"><div class="log-text" style="color:var(--muted)">No log entries yet.</div></div>';
    return;
  }
  el.innerHTML = LOGS.map(
    (l) => `
    <div class="log-item" data-type="${l.type}">
      <div class="log-dot-wrap"><div class="log-dot ${l.color}"></div></div>
      <div class="log-text">${l.text}</div>
      <div class="log-time">${l.time}</div>
    </div>
  `,
  ).join("");
};
function renderFullLog() {
  window.renderFullLog();
}

window.filterLogs = function (type, btn) {
  document
    .querySelectorAll("#page-logs .chip")
    .forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const el = document.getElementById("full-log");
  if (!el) return;
  el.querySelectorAll(".log-item").forEach((item) => {
    item.style.display =
      type === "all" || item.dataset.type === type ? "" : "none";
  });
};

// ═══════════════════════════════════════════════════════════════════
//  EMERGENCY ALERTS
// ═══════════════════════════════════════════════════════════════════
window.triggerAlert = function (type) {
  currentAlertType = type;
  const alertTypeEl = document.getElementById("alertType");
  if (alertTypeEl) alertTypeEl.textContent = type;
  document.getElementById("alertConfirmModal")?.classList.add("open");
};

window.confirmAlert = async function () {
  closeModal("alertConfirmModal");

  try {
    await writeAlert(currentAlertType, "wine");
    showToast(`🚨 ALERT SENT: ${currentAlertType}`, "error");
    addLog(
      "alert",
      `<strong>Emergency alert</strong> triggered: ${currentAlertType}`,
      "wine",
    );

    const statusEls = document.querySelectorAll(
      "#emrg-status-full, .emrg-status",
    );
    statusEls.forEach((el) => {
      el.innerHTML = `Status: <span style="color:var(--wine);font-weight:700">🚨 ACTIVE — ${currentAlertType}</span>`;
      setTimeout(() => {
        el.innerHTML = `Status: <span class="emrg-ok">● All Clear</span> — No active emergencies`;
      }, 8000);
    });
  } catch (err) {
    console.error("[DTI] ❌ Failed to write alert:", err);
    showToast("Alert write failed: " + err.message, "error");
  }
};

window.renderAlertLog = function () {
  const el = document.getElementById("alert-log");
  if (!el) return;
  if (alertHistory.length === 0) {
    el.innerHTML =
      '<div class="log-item"><div class="log-text" style="color:var(--muted)">No alerts recorded.</div></div>';
    return;
  }
  el.innerHTML = alertHistory
    .map(
      (a) => `
    <div class="log-item">
      <div class="log-dot-wrap"><div class="log-dot ${a.color}"></div></div>
      <div class="log-text"><strong>${a.type}</strong></div>
      <div class="log-time">${a.time}</div>
    </div>
  `,
    )
    .join("");
};
function renderAlertLog() {
  window.renderAlertLog();
}

// ═══════════════════════════════════════════════════════════════════
//  ORDERS  (local state — no Firestore collection yet)
// ═══════════════════════════════════════════════════════════════════
const SEED_ORDERS = [
  // {
  //   id: "ORD-091",
  //   user: "Abena Asante",
  //   item: "USB-C Hub",
  //   qty: 1,
  //   price: "₵120",
  //   time: "2m ago",
  //   processed: false,
  //   emoji: "💻",
  // },
  // {
  //   id: "ORD-090",
  //   user: "Kwame Osei",
  //   item: "DTI T-Shirt",
  //   qty: 2,
  //   price: "₵110",
  //   time: "8m ago",
  //   processed: false,
  //   emoji: "👕",
  // },
  // {
  //   id: "ORD-089",
  //   user: "Ama Boateng",
  //   item: "Graph Paper Pad",
  //   qty: 3,
  //   price: "₵25.50",
  //   time: "15m ago",
  //   processed: false,
  //   emoji: "📓",
  // },
  // {
  //   id: "ORD-088",
  //   user: "Yaw Darko",
  //   item: "Notebook A5",
  //   qty: 1,
  //   price: "₵15",
  //   time: "22m ago",
  //   processed: false,
  //   emoji: "📔",
  // },
  // {
  //   id: "ORD-087",
  //   user: "Efua Tetteh",
  //   item: "Energy Drink",
  //   qty: 4,
  //   price: "₵32",
  //   time: "31m ago",
  //   processed: false,
  //   emoji: "🥤",
  // },
  // {
  //   id: "ORD-086",
  //   user: "Akosua Frimpong",
  //   item: "DTI Cap",
  //   qty: 1,
  //   price: "₵40",
  //   time: "45m ago",
  //   processed: true,
  //   emoji: "🧢",
  // },
  // {
  //   id: "ORD-085",
  //   user: "Nana Agyei",
  //   item: "Wireless Mouse",
  //   qty: 1,
  //   price: "₵95",
  //   time: "1h ago",
  //   processed: true,
  //   emoji: "🖱️",
  // },
  // {
  //   id: "ORD-084",
  //   user: "Kofi Mensah",
  //   item: "Mechanical Pencil",
  //   qty: 5,
  //   price: "₵60",
  //   time: "1.5h ago",
  //   processed: true,
  //   emoji: "✏️",
  // },
  // {
  //   id: "ORD-083",
  //   user: "Maame Adjoa",
  //   item: "Jollof Rice",
  //   qty: 2,
  //   price: "₵40",
  //   time: "2h ago",
  //   processed: true,
  //   emoji: "🍛",
  // },
];
ORDERS = [...SEED_ORDERS];

window.renderOrders = function (filter) {
  if (filter !== undefined) currentOrderFilter = filter;
  const list = document.getElementById("orders-list");
  if (!list) return;
  const filtered =
    currentOrderFilter === "all"
      ? ORDERS
      : currentOrderFilter === "pending"
        ? ORDERS.filter((o) => !o.processed)
        : ORDERS.filter((o) => o.processed);
  if (filtered.length === 0) {
    list.innerHTML =
      '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">No orders in this category.</div>';
    return;
  }
  list.innerHTML = filtered
    .map(
      (o) => `
    <div class="order-row" id="order-row-${o.id}">
      <div class="order-avatar">${o.emoji}</div>
      <div class="order-info">
        <div class="order-name">${o.item} × ${o.qty}</div>
        <div class="order-meta">${o.user} · ${o.time}</div>
      </div>
      <div class="order-price">${o.price}</div>
      <button class="btn-process${o.processed ? " processed" : ""}"
        onclick="processOrder('${o.id}', this)"
        ${o.processed ? "disabled" : ""}>
        ${o.processed ? "✓ Done" : "Process"}
      </button>
    </div>
  `,
    )
    .join("");
};
function renderOrders() {
  window.renderOrders();
}

window.filterOrders = function (f, btn) {
  currentOrderFilter = f;
  document
    .querySelectorAll(".tab-row .tab")
    .forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderOrders();
};

window.processOrder = function (id, btn) {
  const order = ORDERS.find((o) => o.id === id);
  if (!order || order.processed) return;
  order.processed = true;
  if (btn) {
    btn.classList.add("processed");
    btn.textContent = "✓ Done";
    btn.disabled = true;
  }
  const pending = ORDERS.filter((o) => !o.processed).length;
  const statEl = document.getElementById("stat-orders");
  if (statEl) statEl.textContent = pending;
  showToast(`Order ${id} processed successfully`, "success");
  addLog("order", `<strong>Order ${id}</strong> marked as processed`, "green");
};

// ═══════════════════════════════════════════════════════════════════
//  USERS  (driven by Firestore "users" collection via subscribeUsers)
// ═══════════════════════════════════════════════════════════════════

window.renderUsers = function (filter) {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;
  const searchVal = (
    document.getElementById("userSearch")?.value || ""
  ).toLowerCase();
  let data =
    filter && filter !== "all" ? USERS.filter((u) => u.role === filter) : USERS;
  if (searchVal)
    data = data.filter(
      (u) =>
        u.name.toLowerCase().includes(searchVal) ||
        u.email.toLowerCase().includes(searchVal) ||
        u.id.toLowerCase().includes(searchVal),
    );
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--muted)">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = data
    .map(
      (u) => `
    <tr id="user-row-${u.id}">
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div class="user-avatar-sm">${u.initials}</div>
          <div>
            <div style="font-size:12.5px;font-weight:600;color:var(--ink)">${u.name}</div>
            <div style="font-size:10.5px;color:var(--muted)">${u.email}</div>
          </div>
        </div>
      </td>
      <td style="font-family:monospace;font-size:11px;color:var(--muted)">${u.id}</td>
      <td style="font-size:11.5px">${u.campus}</td>
      <td>
        <select class="role-select" onchange="changeRole('${u.id}', this.value)">
          <option value="visitor" ${u.role === "visitor" ? "selected" : ""}>Visitor</option>
          <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
          <option value="staff"   ${u.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="admin"   ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${u.status === "active" ? "#1a9e50" : "var(--muted)"}">
          <span style="width:6px;height:6px;border-radius:50%;background:${u.status === "active" ? "#2ecc71" : "var(--dim)"}"></span>
          ${u.status.charAt(0).toUpperCase() + u.status.slice(1)}
        </span>
      </td>
      <td>
        ${u.role === "staff" ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${u.verified ? "#1a9e50" : "var(--wine)"}">
          <span style="width:6px;height:6px;border-radius:50%;background:${u.verified ? "#2ecc71" : "var(--wine)"}"></span>
          ${u.verified ? "Verified" : "Pending"}
        </span>` : `<span style="font-size:11px;color:var(--muted)">—</span>`}
      </td>
      <td style="font-size:11.5px;color:var(--muted)">${u.joined}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center">
          ${u.role === "staff" && !u.verified ? `<button class="icon-btn save" onclick="approveUser('${u.id}')">✓</button>` : ""}
          ${u.role === "staff" && !u.verified ? `<button class="icon-btn del" onclick="rejectUser('${u.id}')">✕</button>` : ""}
          <button class="icon-btn edit" title="Edit" onclick="showToast('Editing ${u.name}', 'gold')">✏️</button>
          <button class="btn-remove" onclick="removeUser('${u.id}')">Remove</button>
        </div>
      </td>
    </tr>
  `,
    )
    .join("");
};
function renderUsers(filter) {
  window.renderUsers(filter);
}

window.filterUsers = function () {
  renderUsers(currentUserRoleFilter === "all" ? null : currentUserRoleFilter);
};

window.filterUserRole = function (role, btn) {
  currentUserRoleFilter = role;
  document
    .querySelectorAll("#page-users .chip")
    .forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderUsers(role === "all" ? null : role);
};

window.changeRole = async function (id, newRole) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  const old = user.role;
  try {
    await updateDoc(doc(db, "users", id), { role: newRole });
    showToast(`${user.name} role changed: ${old} → ${newRole}`, "success");
    addLog(
      "admin",
      `<strong>${user.name}</strong> role changed: ${old} → ${newRole}`,
      "wine",
    );
    speak(
      `Administrative update complete. A new account has been successfully appended to the centralized records.`,
    );
  } catch (err) {
    console.error("[DTI] ❌ Failed to update role:", err);
    showToast("Role update failed: " + err.message, "error");
  }
};

window.approveUser = async function (id) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  try {
    await updateDoc(doc(db, "users", id), { verified: true });
    showToast(`${user.name} verified and granted access`, "success");
    addLog(
      "admin",
      `<strong>${user.name}</strong> staff verification approved`,
      "gold",
    );
  } catch (err) {
    console.error("[DTI] ❌ Failed to verify user:", err);
    showToast("Verification failed: " + err.message, "error");
  }
};

window.rejectUser = async function (id) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  showConfirm(
    "Reject Staff Application",
    `Remove ${user.name}'s staff access request?`,
    async () => {
      try {
        await deleteDoc(doc(db, "users", id));
        showToast(`${user.name} staff request removed`, "error");
        addLog(
          "admin",
          `<strong>${user.name}</strong> staff request rejected and removed`,
          "wine",
        );
      } catch (err) {
        console.error("[DTI] ❌ Failed to reject user:", err);
        showToast("Rejection failed: " + err.message, "error");
      }
    }
  );
};

function renderPendingStaff() {
  const listEl = document.getElementById("pending-verification-list");
  const countEl = document.getElementById("pending-count");
  const pending = USERS.filter((u) => u.role === "staff" && !u.verified);
  if (!listEl) return;
  if (countEl) countEl.textContent = `(${pending.length})`;

  if (pending.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">No pending staff accounts.</div>';
    return;
  }
  listEl.innerHTML = pending
    .map(
      (u) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--ash)">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--wine),var(--gold));display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${u.initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--ink)">${u.name}</div>
        <div style="font-size:10.5px;color:var(--muted)">${u.email}</div>
      </div>
      <button class="icon-btn save" onclick="approveUser('${u.id}')">✓</button>
      <button class="icon-btn del" onclick="rejectUser('${u.id}')">✕</button>
    </div>
  `,
    )
    .join("");
}

window.removeUser = function (id) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  showConfirm(
    "Remove User",
    `Remove ${user.name} from the platform? This action cannot be undone.`,
    async () => {
      try {
        await deleteDoc(doc(db, "users", id));
        showToast(`${user.name} removed`, "error");
        addLog(
          "user",
          `<strong>${user.name}</strong> account removed from platform`,
          "wine",
        );
      } catch (err) {
        console.error("[DTI] ❌ Failed to remove user:", err);
        showToast("Remove failed: " + err.message, "error");
      }
    }
  );
};

window.openAddUserModal = function () {
  document.getElementById("addUserModal")?.classList.add("open");
};

window.addUser = async function () {
  const name = document.getElementById("new-user-name")?.value.trim();
  const email = document.getElementById("new-user-email")?.value.trim();
  const role = document.getElementById("new-user-role")?.value;
  const campus = document.getElementById("new-user-campus")?.value;
  if (!name || !email) {
    showToast("Please fill all fields", "error");
    return;
  }
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  try {
    await addDoc(collection(db, "users"), {
      name,
      email,
      role,
      campus,
      initials,
      status: "active",
      joined: new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
      createdAt: serverTimestamp(),
    });
    closeModal("addUserModal");
    showToast(`${name} added as ${role}`, "success");
    addLog(
      "user",
      `<strong>New user</strong> ${name} registered as ${role}`,
      "gold",
    );
    speak(
      `Administrative update complete. A new account has been successfully appended to the centralized records.`,
    );
    const nameEl = document.getElementById("new-user-name");
    const emailEl = document.getElementById("new-user-email");
    if (nameEl) nameEl.value = "";
    if (emailEl) emailEl.value = "";
  } catch (err) {
    console.error("[DTI] ❌ Failed to add user:", err);
    showToast("Failed to add user: " + err.message, "error");
  }
};

// ═══════════════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════════════
window.closeModal = function (id) {
  document.getElementById(id)?.classList.remove("open");
};
function closeModal(id) {
  window.closeModal(id);
}

// ═══════════════════════════════════════════════════════════════════
//  SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════
window.openSettings = function () {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.classList.add("open");
  const user = auth.currentUser;
  if (user) {
    const nameEl = document.getElementById("settings-admin-name");
    const emailEl = document.getElementById("settings-admin-email");
    if (nameEl)
      nameEl.textContent =
        user.displayName || user.email?.split("@")[0] || "Admin";
    if (emailEl) emailEl.textContent = user.email || "—";
  }
  switchSettingsTab("account");
};

window.switchSettingsTab = function (tab) {
  document
    .querySelectorAll(".settings-tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".settings-tab-pane")
    .forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(`.settings-tab-btn[data-tab="${tab}"]`);
  const pane = document.getElementById(`settings-tab-${tab}`);
  if (btn) btn.classList.add("active");
  if (pane) pane.classList.add("active");
};

window.handleSignOut = async function () {
  try {
    await signOut(auth);
    showToast("Signed out successfully", "success");
    closeModal("settingsModal");
    addLog("admin", "<strong>Admin signed out</strong> from dashboard", "wine");
    if (!isFrame) {
      window.location.href = "login-admin.html";
    }
  } catch (err) {
    console.error("[DTI] Sign-out error:", err);
    showToast("Sign out failed: " + err.message, "error");
  }
};

window.handleSignIn = async function () {
  const emailEl = document.getElementById("signin-email");
  const passEl = document.getElementById("signin-password");
  const errEl = document.getElementById("signin-error");
  const email = emailEl?.value.trim();
  const pass = passEl?.value;

  if (!email || !pass) {
    if (errEl) errEl.textContent = "Please enter both email and password.";
    return;
  }
  if (errEl) errEl.textContent = "";

  const btn = document.getElementById("signin-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Signing in…";
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showToast("Signed in successfully", "success");
    closeModal("settingsModal");
    if (emailEl) emailEl.value = "";
    if (passEl) passEl.value = "";
    addLog("admin", `<strong>Admin signed in</strong> as ${email}`, "gold");
    speak(
      "Authentication complete. Admin session has been securely activated.",
    );
  } catch (err) {
    console.error("[DTI] Sign-in error:", err);
    if (errEl) errEl.textContent = friendlyAuthError(err.code);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  }
};

window.handleUpdatePassword = async function () {
  const currentEl = document.getElementById("pw-current");
  const newEl = document.getElementById("pw-new");
  const confirmEl = document.getElementById("pw-confirm");
  const errEl = document.getElementById("pw-error");

  const currentPw = currentEl?.value;
  const newPw = newEl?.value;
  const confirmPw = confirmEl?.value;

  if (!currentPw || !newPw || !confirmPw) {
    if (errEl) errEl.textContent = "Please fill in all password fields.";
    return;
  }
  if (newPw !== confirmPw) {
    if (errEl) errEl.textContent = "New passwords do not match.";
    return;
  }
  if (newPw.length < 6) {
    if (errEl) errEl.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (errEl) errEl.textContent = "";

  const user = auth.currentUser;
  if (!user || !user.email) {
    if (errEl) errEl.textContent = "No admin signed in.";
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPw);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPw);
    showToast("Password updated successfully", "success");
    if (currentEl) currentEl.value = "";
    if (newEl) newEl.value = "";
    if (confirmEl) confirmEl.value = "";
    addLog("admin", "<strong>Password</strong> changed by admin", "gold");
    speak(
      "Security update confirmed. Admin password has been successfully updated and secured.",
    );
  } catch (err) {
    console.error("[DTI] Password update error:", err);
    if (errEl) errEl.textContent = friendlyAuthError(err.code);
  }
};

window.handleUpdateDisplayName = async function () {
  const nameEl = document.getElementById("display-name-input");
  const errEl = document.getElementById("display-name-error");
  const name = nameEl?.value.trim();

  if (!name) {
    if (errEl) errEl.textContent = "Please enter a display name.";
    return;
  }
  if (errEl) errEl.textContent = "";

  const user = auth.currentUser;
  if (!user) {
    if (errEl) errEl.textContent = "No admin signed in.";
    return;
  }

  try {
    await updateProfile(user, { displayName: name });
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    document
      .querySelectorAll(".sb-admin-name, .tb-profile-name")
      .forEach((el) => (el.textContent = name));
    document
      .querySelectorAll(".sb-avatar, .tb-profile-avatar")
      .forEach((el) => (el.textContent = initials));
    const sNameEl = document.getElementById("settings-admin-name");
    if (sNameEl) sNameEl.textContent = name;
    showToast("Display name updated", "success");
    addLog("admin", `<strong>Admin name</strong> updated to ${name}`, "gold");
    if (nameEl) nameEl.value = "";
    speak(
      `System update complete. Admin display name has been successfully updated to ${name}.`,
    );
  } catch (err) {
    console.error("[DTI] Display name update error:", err);
    if (errEl) errEl.textContent = "Update failed: " + err.message;
  }
};

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-email": "Invalid email address format.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment.",
    "auth/invalid-credential": "Invalid credentials. Check email and password.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/requires-recent-login":
      "Please sign in again before changing your password.",
  };
  return map[code] || "An error occurred. Please try again.";
}