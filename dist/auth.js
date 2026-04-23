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
...

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
