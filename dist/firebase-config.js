export const firebaseConfig = {
  apiKey: "AIzaSyC-kjqLJgf7JhqYG_fNEDgCEMNegcM3RRE",
  authDomain: "chatter-b1750.firebaseapp.com",
  projectId: "chatter-b1750",
  storageBucket: "chatter-b1750.firebasestorage.app",
  messagingSenderId: "907858761189",
  appId: "1:907858761189:web:b654343fd615fc2da3cb0c",
  measurementId: "G-LK87L7H62G"
};

export const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => (
  value && !value.startsWith("PASTE_")
));
