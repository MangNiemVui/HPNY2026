// services.js (ESM module)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let app = null;
let auth = null;
let db = null;

let ownerUser = null;

// View tracking
let viewSession = null; // { docId, startedAtMs, viewer, target }

function mustConfig(name){
  if (!window[name]) throw new Error(`Missing config: window.${name}`);
}

async function initFirebaseIfNeeded(){
  mustConfig("FIREBASE_CONFIG");

  if (!getApps().length){
    app = initializeApp(window.FIREBASE_CONFIG);
  } else {
    app = getApps()[0];
  }

  auth = getAuth(app);
  db = getFirestore(app);

  // chỉ gắn listener 1 lần
  if (!initFirebaseIfNeeded._subscribed){
    initFirebaseIfNeeded._subscribed = true;
    onAuthStateChanged(auth, (u) => { ownerUser = u || null; });
  }
}

function isOwnerAuthed(){
  if (!ownerUser) return false;
  return String(ownerUser.uid || "") === String(window.OWNER_UID || "");
}

async function ownerGoogleLogin(){
  await initFirebaseIfNeeded();
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  ownerUser = cred.user;
  return { uid: ownerUser.uid, email: ownerUser.email || "" };
}

async function ownerGoogleLogout(){
  await initFirebaseIfNeeded();
  await signOut(auth);
  ownerUser = null;
}

async function startView(viewer, target){
  await initFirebaseIfNeeded();

  const payload = {
    ownerKey: window.OWNER_KEY || "",
    viewerKey: viewer?.key || "",
    viewerLabel: viewer?.label || "",
    targetKey: target?.key || "",
    targetLabel: target?.label || "",
    startedAt: serverTimestamp(),
    endedAt: null,
    durationSec: 0,
    userAgent: navigator.userAgent || ""
  };

  const ref = await addDoc(collection(db, "views"), payload);
  viewSession = { docId: ref.id, startedAtMs: Date.now(), viewer, target };
}

async function stopView(){
  // demo: không update endedAt để tránh cần quyền update
  viewSession = null;
}

async function getLatestViews(n=200){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Not owner authed");

  const q = query(
    collection(db, "views"),
    orderBy("startedAt", "desc"),
    limit(Math.min(500, n))
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getLatestWishes(n=200){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Not owner authed");

  const q = query(
    collection(db, "wishes"),
    orderBy("createdAt", "desc"),
    limit(Math.min(500, n))
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ✅ Owner delete
async function deleteView(docId){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Not owner authed");
  if (!docId) throw new Error("Missing docId");
  await deleteDoc(doc(db, "views", String(docId)));
}

async function deleteWish(docId){
  await initFirebaseIfNeeded();
  if (!isOwnerAuthed()) throw new Error("Not owner authed");
  if (!docId) throw new Error("Missing docId");
  await deleteDoc(doc(db, "wishes", String(docId)));
}

async function sendWish({ viewerKey, viewerLabel, targetKey, targetLabel, message }){
  await initFirebaseIfNeeded();

  // 1) Save to Firestore
  const payload = {
    ownerKey: window.OWNER_KEY || "",
    viewerKey, viewerLabel,
    targetKey, targetLabel,
    message,
    createdAt: serverTimestamp()
  };

  await addDoc(collection(db, "wishes"), payload);

   // 2) Try EmailJS
  let emailed = false;
  try{
    // ✅ lấy đúng object emailjs (có thể nằm ở .default)
    const EJ = window.emailjs?.send ? window.emailjs : window.emailjs?.default;

    if (EJ && window.EMAILJS_PUBLIC_KEY && window.EMAILJS_SERVICE_ID && window.EMAILJS_TEMPLATE_ID){

      // ✅ init bằng string cho chắc
      EJ.init(window.EMAILJS_PUBLIC_KEY);

      // ✅ truyền public key vào tham số thứ 4 để chắc chắn không bị mất key
      await EJ.send(
        window.EMAILJS_SERVICE_ID,
        window.EMAILJS_TEMPLATE_ID,
        {
          from_name: viewerLabel || viewerKey || "Ẩn danh",
          from_key: viewerKey || "",
          card_target: targetLabel || targetKey || "",
          time: new Date().toLocaleString("vi-VN"),
          message: message || "",
          email: window.OWNER_EMAIL || "" // (optional) dùng cho Reply-To nếu template có {{email}}
        },
        window.EMAILJS_PUBLIC_KEY
      );

      emailed = true;
    } else {
      console.warn("EmailJS missing config or script not loaded", {
        hasEJ: !!EJ,
        pub: !!window.EMAILJS_PUBLIC_KEY,
        service: !!window.EMAILJS_SERVICE_ID,
        tpl: !!window.EMAILJS_TEMPLATE_ID,
      });
    }
  }catch(e){
    console.warn("EmailJS send failed:", e);
    console.warn("status:", e?.status);
    console.warn("text:", e?.text);
  }


// expose to window
window.AppServices = {
  initFirebaseIfNeeded,
  isOwnerAuthed,
  ownerGoogleLogin,
  ownerGoogleLogout,
  startView,
  stopView,
  getLatestViews,
  getLatestWishes,
  deleteView,
  deleteWish,
  sendWish
};
