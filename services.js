import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

let app = null;
let db = null;
let auth = null;

let ownerUser = null;

// view session tracking
let viewDocRef = null;
let viewStartMs = 0;

function mustConfig() {
  if (!window.FIREBASE_CONFIG) throw new Error("Thiếu FIREBASE_CONFIG trong config.js");
  if (!window.OWNER_KEY) throw new Error("Thiếu OWNER_KEY trong config.js");
}

async function initFirebaseIfNeeded(){
  mustConfig();
  if (app && db && auth) return;

  if (!getApps().length){
    app = initializeApp(window.FIREBASE_CONFIG);
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
  auth = getAuth(app);

  onAuthStateChanged(auth, (u) => {
    ownerUser = u || null;
  });
}

function isOwnerAuthed(){
  return !!ownerUser;
}

async function ownerGoogleLogin(){
  await initFirebaseIfNeeded();
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  ownerUser = res.user;
  return { uid: ownerUser.uid, email: ownerUser.email };
}

async function ownerGoogleLogout(){
  await initFirebaseIfNeeded();
  await signOut(auth);
  ownerUser = null;
}

function isOwnerUID(){
  return !!ownerUser && !!window.OWNER_UID && ownerUser.uid === window.OWNER_UID;
}

// ===== Views tracking =====
async function startView(viewer, target){
  try{
    await initFirebaseIfNeeded();
    viewStartMs = Date.now();
    viewDocRef = await addDoc(collection(db, "views"), {
      ownerKey: window.OWNER_KEY,
      viewerKey: viewer?.key || "",
      viewerLabel: viewer?.label || "",
      targetKey: target?.key || "",
      targetLabel: target?.label || "",
      startedAt: serverTimestamp(),
      endedAt: null,
      durationSec: 0,
      userAgent: navigator.userAgent || ""
    });
  }catch(e){
    // views fail is not fatal
    console.warn("startView failed:", e);
  }
}

async function stopView(){
  try{
    if (!db || !viewDocRef) return;
    const durationSec = Math.max(0, Math.round((Date.now() - viewStartMs)/1000));
    await updateDoc(doc(db, "views", viewDocRef.id), {
      endedAt: serverTimestamp(),
      durationSec
    });
  }catch(e){
    console.warn("stopView failed:", e);
  }finally{
    viewDocRef = null;
    viewStartMs = 0;
  }
}

// ===== Wishes send =====
async function sendWish({ viewerKey, viewerLabel, targetKey, targetLabel, message }){
  await initFirebaseIfNeeded();

  const payload = {
    ownerKey: window.OWNER_KEY,
    viewerKey,
    viewerLabel,
    targetKey,
    targetLabel,
    message,
    createdAt: serverTimestamp()
  };

  let savedToFirestore = false;
  let emailed = false;

  // Save to Firestore (public write)
  try{
    await addDoc(collection(db, "wishes"), payload);
    savedToFirestore = true;
  }catch(e){
    console.warn("save wish failed:", e);
  }

  // EmailJS (optional)
  try{
    if (window.emailjs && window.EMAILJS_PUBLIC_KEY && window.EMAILJS_SERVICE_ID && window.EMAILJS_TEMPLATE_ID){
      window.emailjs.init(window.EMAILJS_PUBLIC_KEY);

      // bạn map field theo template emailjs của bạn
      const params = {
        to_email: window.OWNER_EMAIL_TO || "",
        viewer_key: viewerKey,
        viewer_label: viewerLabel,
        target_key: targetKey,
        target_label: targetLabel,
        message: message
      };

      await window.emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, params);
      emailed = true;
    }
  }catch(e){
    console.warn("emailjs send failed:", e);
  }

  return { savedToFirestore, emailed };
}

// ===== Owner read =====
async function getLatestViews(n=100){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Owner chưa login.");
  if (!isOwnerUID()) throw new Error("Owner login OK nhưng UID chưa khớp OWNER_UID trong config.js.");

  const qy = query(collection(db, "views"), orderBy("startedAt", "desc"), limit(n));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getLatestWishes(n=100){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Owner chưa login.");
  if (!isOwnerUID()) throw new Error("Owner login OK nhưng UID chưa khớp OWNER_UID trong config.js.");

  const qy = query(collection(db, "wishes"), orderBy("createdAt", "desc"), limit(n));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// expose
window.AppServices = {
  initFirebaseIfNeeded,
  isOwnerAuthed,
  ownerGoogleLogin,
  ownerGoogleLogout,
  startView,
  stopView,
  sendWish,
  getLatestViews,
  getLatestWishes
};
