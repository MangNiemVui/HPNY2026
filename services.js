// services.js (ES module)
// Firebase: view tracking + saving wishes + owner-only dashboard helpers
// EmailJS: send wish -> owner's Gmail

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, serverTimestamp, updateDoc, doc,
  getDocs, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';

let app = null;
let db = null;
let auth = null;

let viewDocRef = null;
let viewStartMs = 0;
let pingTimer = null;

function hasFirebaseConfig() {
  const c = window.FIREBASE_CONFIG || {};
  return !!(c.apiKey && c.projectId && c.appId);
}

async function initFirebaseIfNeeded() {
  if (db) return { db, auth };
  if (!hasFirebaseConfig()) return { db: null, auth: null };

  app = initializeApp(window.FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);

  // anonymous sign-in so writes can be secured by request.auth != null
  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.warn('Firebase anonymous auth failed:', e);
  }

  return { db, auth };
}

function initEmailJSIfNeeded() {
  try {
    if (!window.emailjs) return false;
    if (!window.EMAILJS_PUBLIC_KEY) return false;
    window.emailjs.init({ publicKey: window.EMAILJS_PUBLIC_KEY });
    return true;
  } catch (e) {
    console.warn('EmailJS init failed:', e);
    return false;
  }
}

function safeNowIso() {
  return new Date().toISOString();
}

// ============ View tracking (Firestore: views) ============
async function startView(viewer, target) {
  await initFirebaseIfNeeded();
  if (!db) return; // Firebase not configured

  await stopView(); // stop previous session if any

  viewStartMs = Date.now();
  const payload = {
    ownerKey: window.OWNER_KEY || '',
    viewerKey: viewer?.key || '',
    viewerLabel: viewer?.label || '',
    viewerRole: viewer?.role || 'guest',
    viewerAuthUid: auth?.currentUser?.uid || '',
    targetKey: target?.key || '',
    targetLabel: target?.label || '',
    startedAt: serverTimestamp(),
    lastPingAt: serverTimestamp(),
    endedAt: null,
    durationSec: 0,
    userAgent: navigator.userAgent || '',
    referrer: document.referrer || '',
  };

  viewDocRef = await addDoc(collection(db, 'views'), payload);

  // heartbeat update every 10s
  pingTimer = setInterval(async () => {
    try {
      if (!viewDocRef) return;
      const durationSec = Math.max(0, Math.floor((Date.now() - viewStartMs) / 1000));
      await updateDoc(doc(db, 'views', viewDocRef.id), {
        lastPingAt: serverTimestamp(),
        durationSec,
      });
    } catch (e) {
      // ignore transient errors
    }
  }, 10000);

  // best-effort flush on leaving
  window.addEventListener('pagehide', stopView, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopView();
  }, { once: true });
}

async function stopView() {
  try {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    await initFirebaseIfNeeded();
    if (!db || !viewDocRef) return;

    const durationSec = Math.max(0, Math.floor((Date.now() - viewStartMs) / 1000));
    await updateDoc(doc(db, 'views', viewDocRef.id), {
      endedAt: serverTimestamp(),
      lastPingAt: serverTimestamp(),
      durationSec,
    });
  } catch (e) {
    // ignore
  } finally {
    viewDocRef = null;
    viewStartMs = 0;
  }
}

// ============ Wishes (Firestore: wishes) + EmailJS ============
async function sendWish({ viewerKey, viewerLabel, targetKey, targetLabel, message }) {
  // Returns:
  // { savedToFirestore: boolean, emailed: boolean }
  await initFirebaseIfNeeded();

  let savedToFirestore = false;
  let emailed = false;

  // 1) save wish to Firestore (recommended)
  if (db) {
    await addDoc(collection(db, 'wishes'), {
      ownerKey: window.OWNER_KEY || '',
      viewerKey: viewerKey || '',
      viewerLabel: viewerLabel || '',
      viewerAuthUid: auth?.currentUser?.uid || '',
      targetKey: targetKey || '',
      targetLabel: targetLabel || '',
      message: message || '',
      createdAt: serverTimestamp(),
      ua: navigator.userAgent || '',
    });
    savedToFirestore = true;
  }

  // 2) send to owner Gmail via EmailJS (optional)
  const canEmail = !!(
    window.EMAILJS_PUBLIC_KEY &&
    window.EMAILJS_SERVICE_ID &&
    window.EMAILJS_TEMPLATE_ID &&
    window.OWNER_EMAIL
  );
  if (canEmail) {
    const ok = initEmailJSIfNeeded();
    if (ok) {
      const templateParams = {
        to_email: window.OWNER_EMAIL,
        from_name: viewerLabel || viewerKey || 'Ẩn danh',
        from_key: viewerKey || '',
        card_target: targetLabel || targetKey || '',
        message: message || '',
        time: safeNowIso(),
      };

      await window.emailjs.send(
        window.EMAILJS_SERVICE_ID,
        window.EMAILJS_TEMPLATE_ID,
        templateParams
      );
      emailed = true;
    }
  }

  return { savedToFirestore, emailed };
}

// ============ Owner auth (Google) ============
 (Google) ============
function isOwnerAuthed() {
  try {
    if (!auth || !auth.currentUser) return false;
    if (!window.OWNER_UID) return false;
    return auth.currentUser.uid === window.OWNER_UID;
  } catch {
    return false;
  }
}

async function ownerGoogleLogin() {
  await initFirebaseIfNeeded();
  if (!auth) throw new Error('Auth not initialized');

  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);

  return {
    uid: auth.currentUser?.uid || '',
    email: auth.currentUser?.email || '',
    name: auth.currentUser?.displayName || '',
  };
}

async function ownerGoogleLogout() {
  await initFirebaseIfNeeded();
  if (!auth) return;
  await signOut(auth);

  // Back to anonymous so normal visitors can still write views/wishes
  try { await signInAnonymously(auth); } catch {}
}

// ============ Owner dashboard helpers ============
async function getLatestViews(max = 200) {
  await initFirebaseIfNeeded();
  if (!db) return [];
  const qy = query(collection(db, 'views'), orderBy('startedAt', 'desc'), limit(max));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getLatestWishes(max = 200) {
  await initFirebaseIfNeeded();
  if (!db) return [];
  const qy = query(collection(db, 'wishes'), orderBy('createdAt', 'desc'), limit(max));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Expose to window so index.html inline script can call
window.AppServices = {
  initFirebaseIfNeeded,
  startView,
  stopView,
  sendWish,
  getLatestViews,
  getLatestWishes,
  ownerGoogleLogin,
  ownerGoogleLogout,
  isOwnerAuthed,
};
