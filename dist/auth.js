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
const passwordInput = document.getElementById("password");
const submitButton = authForm ? authForm.querySelector('button[type="submit"]') : null;

const firebaseApp = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;
const googleProvider = hasFirebaseConfig ? new GoogleAuthProvider() : null;

if (googleProvider) {
  googleProvider.setCustomParameters({
    prompt: "select_account"
  });
}

if (!authForm || !googleButton || !statusText || !emailInput || !nameInput || !passwordInput) {
  throw new Error("Login page is missing required auth elements.");
}

if (!hasFirebaseConfig) {
  setStatus("Add your Firebase config in dist/firebase-config.js to enable login.");
  authForm.classList.add("has-config-error");
  googleButton.disabled = true;
  if (submitButton) {
    submitButton.disabled = true;
  }
}

if (auth) {
  getRedirectResult(auth)
    .then((result) => {
      if (result && result.user) {
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

  if (!email || !password) {
    setStatus("Enter your email and password.");
    return;
  }

  setLoading(true, "Signing in...");

  try {
    let credential;

    try {
      credential = await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (error.code !== "auth/user-not-found" && error.code !== "auth/invalid-credential" && error.code !== "auth/invalid-login-credentials") {
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
  if (!auth || !googleProvider) {
    setStatus("Firebase is not configured yet.");
    return;
  }

  setLoading(true, "Redirecting to Google...");

  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    setStatus(formatAuthError(error));
    setLoading(false);
  }
});

async function completeLogin(user, method, fallbackName = "") {
  const profile = await ensureUserProfile(user, fallbackName, method);

  const users = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  if (!users.includes(profile.email)) {
    users.push(profile.email);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  localStorage.setItem(SESSION_KEY, profile.email);
  localStorage.setItem(SESSION_UID_KEY, user.uid);
  setStatus("Success. Redirecting...");
  window.location.href = "../app.html";
}

async function ensureUserProfile(user, fallbackName, method) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  const existingData = userSnap.exists() ? userSnap.data() : {};
  const resolvedName = (user.displayName || fallbackName || existingData.name || user.email.split("@")[0] || "Lumen User").trim();
  const email = (user.email || existingData.email || "").trim().toLowerCase();
  const code = existingData.code || await reserveUserCode(user.uid);
  const profile = {
    name: resolvedName,
    email,
    initials: initials(resolvedName || email || "LC"),
    code,
    authProvider: method,
    files: Array.isArray(existingData.files) ? existingData.files : [],
    events: Array.isArray(existingData.events) ? existingData.events : [],
    createdAt: existingData.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userRef, profile, { merge: true });
  await setDoc(doc(db, "userCodes", code), {
    uid: user.uid,
    email,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return profile;
}

async function reserveUserCode(uid) {
  return runTransaction(db, async (transaction) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateUserCode();
      const codeRef = doc(db, "userCodes", code);
      const codeSnap = await transaction.get(codeRef);

      if (!codeSnap.exists()) {
        transaction.set(codeRef, {
          uid,
          createdAt: serverTimestamp()
        });
        return code;
      }
    }

    throw new Error("Unable to generate a unique Lumen code. Please try again.");
  });
}

function generateUserCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";

  for (let index = 0; index < 6; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return `LC-${suffix}`;
}

function initials(value) {
  return String(value)
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "LC";
}

function setLoading(isLoading, message = "") {
  authForm.classList.toggle("is-loading", isLoading);
  emailInput.disabled = isLoading;
  nameInput.disabled = isLoading;
  passwordInput.disabled = isLoading;
  googleButton.disabled = isLoading;

  if (submitButton) {
    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading ? "Please wait..." : "Sign in";
  }

  if (message) {
    setStatus(message, isLoading ? "info" : "secondary");
  }
}

function setStatus(message, tone = "danger") {
  statusText.textContent = message;
  statusText.className = `alert alert-${tone} mt-3`;
  statusText.hidden = !message;
}

function formatAuthError(error) {
  if (!error || !error.code) {
    return "Authentication failed. Please try again.";
  }

  switch (error.code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/weak-password":
      return "Use a password with at least 6 characters.";
    case "auth/email-already-in-use":
      return "This email is already registered. Try signing in.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication.";
    case "auth/operation-not-allowed":
      return "Enable this sign-in method in Firebase Authentication settings.";
    default:
      return error.message || "Authentication failed. Please try again.";
  }
}
