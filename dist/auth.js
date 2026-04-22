import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "./firebase-config.js";

const USERS_KEY = "lumenChatUsers";
const SESSION_KEY = "lumenChatSession";
const SESSION_UID_KEY = "lumenChatUid";

const authForm = document.getElementById("auth-form");
const googleButton = document.getElementById("google-login");
const statusText = document.getElementById("auth-status");
const emailInput = document.getElementById("user");
const nameInput = document.getElementById("name");
const passwordInput = document.getElementById("pass");

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

if (!hasFirebaseConfig) {
  setStatus("Add your Firebase config in dist/firebase-config.js to enable Google login.");
  authForm.classList.add("has-config-error");
}

if (auth) {
  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        return completeLogin(result.user, "google");
      }

      return null;
    })
    .catch((error) => {
      setStatus(formatAuthError(error));
    });
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!auth) {
    setStatus("Firebase is not configured yet.");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = nameInput.value.trim();

  setLoading(true, "Signing in...");

  try {
    let credential;

    try {
      credential = await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (error.code !== "auth/user-not-found" && error.code !== "auth/invalid-credential") {
        throw error;
      }

      credential = await createUserWithEmailAndPassword(auth, email, password);

      if (name) {
        await updateProfile(credential.user, { displayName: name });
      }
    }

    await completeLogin(credential.user, "email", name);
  } catch (error) {
    setStatus(formatAuthError(error));
    setLoading(false);
  }
});

googleButton.addEventListener("click", async () => {
  if (!auth) {
    setStatus("Firebase is not configured yet.");
    return;
  }

  setLoading(true, "Opening Google...");

  try {
    const result = await signInWithPopup(auth, googleProvider);
    await completeLogin(result.user, "google");
  } catch (error) {
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code)) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    setStatus(formatAuthError(error));
    setLoading(false);
  }
});

async function completeLogin(firebaseUser, provider, fallbackName = "") {
  const email = firebaseUser.email;

  if (!email) {
    setStatus("Firebase did not return an email for this account.");
    setLoading(false);
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const users = getUsers();
  const displayName = firebaseUser.displayName || fallbackName || normalizedEmail.split("@")[0];
  let profile;

  try {
    profile = await ensureUserProfile(firebaseUser, provider, displayName);
  } catch (error) {
    profile = {
      uid: firebaseUser.uid,
      email: normalizedEmail,
      name: displayName,
      initials: initials(displayName || normalizedEmail),
      code: users[normalizedEmail]?.code || randomUserCode(),
      provider
    };
    console.warn("Firestore profile setup failed. Continuing with local session.", error);
  }

  if (!users[normalizedEmail]) {
    users[normalizedEmail] = {
      uid: firebaseUser.uid,
      email: normalizedEmail,
      name: profile.name,
      initials: profile.initials || initials(displayName || normalizedEmail),
      code: profile.code,
      provider,
      conversations: {},
      contacts: [],
      files: [],
      events: [],
      createdAt: new Date().toISOString()
    };
  } else {
    users[normalizedEmail] = {
      ...users[normalizedEmail],
      uid: firebaseUser.uid,
      name: users[normalizedEmail].name || profile.name,
      code: profile.code,
      provider
    };
  }

  saveUsers(users);
  localStorage.setItem(SESSION_KEY, normalizedEmail);
  localStorage.setItem(SESSION_UID_KEY, firebaseUser.uid);
  window.location.href = "../app.html";
}

async function ensureUserProfile(firebaseUser, provider, displayName) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const existingUser = await getDoc(userRef);

  if (existingUser.exists() && existingUser.data().code) {
    await setDoc(userRef, {
      email: firebaseUser.email,
      name: existingUser.data().name || displayName,
      provider,
      lastLoginAt: serverTimestamp()
    }, { merge: true });

    return existingUser.data();
  }

  const code = await createUniqueUserCode(firebaseUser.uid);
  const profile = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    name: displayName,
    initials: initials(displayName || firebaseUser.email),
    code,
    provider,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp()
  };

  await setDoc(userRef, profile, { merge: true });
  return profile;
}

async function createUniqueUserCode(uid) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomUserCode();
    const codeRef = doc(db, "userCodes", code);

    const reserved = await runTransaction(db, async (transaction) => {
      const codeSnap = await transaction.get(codeRef);

      if (codeSnap.exists()) {
        return false;
      }

      transaction.set(codeRef, {
        uid,
        createdAt: serverTimestamp()
      });
      return true;
    });

    if (reserved) {
      return code;
    }
  }

  throw new Error("Could not create a unique user code. Try again.");
}

function randomUserCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes)
    .map((byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return `LC-${value.slice(0, 6)}`;
}

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function initials(nameOrEmail) {
  return nameOrEmail
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "LC";
}

function setLoading(isLoading, message = "") {
  authForm.classList.toggle("is-loading", isLoading);
  googleButton.disabled = isLoading;
  authForm.querySelector(".input-submit").disabled = isLoading;
  setStatus(message);
}

function setStatus(message) {
  statusText.textContent = message;
}

function formatAuthError(error) {
  if (error.code === "auth/unauthorized-domain") {
    return "Add localhost to Firebase Auth authorized domains.";
  }

  if (error.code === "auth/operation-not-allowed") {
    return "Enable this sign-in provider in Firebase Authentication.";
  }

  return error.message || "Authentication failed.";
}
