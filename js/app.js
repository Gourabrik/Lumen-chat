import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { firebaseConfig } from "../dist/firebase-config.js";

const SESSION_KEY = "lumenChatSession";
const SESSION_UID_KEY = "lumenChatUid";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentAuthUser = null;
let currentProfile = null;
let activeConversation = null;
let activeFileFilter = "all";
let calendarDate = new Date();
let conversations = [];
let requests = [];
let messageUnsubscribe = null;

const navItems = document.querySelectorAll(".nav-item[data-view]");
const viewSections = document.querySelectorAll(".view-section");
const codeForm = document.getElementById("code-search-form");
const searchInput = document.getElementById("chat-search-input");
const searchResults = document.getElementById("search-results");
const requestList = document.getElementById("request-list");
const conversationList = document.getElementById("conversation-list");
const copyCodeButton = document.getElementById("copy-code-button");
const threadHeader = document.getElementById("thread-header");
const messageFeed = document.getElementById("message-feed");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const contactsGrid = document.getElementById("contacts-grid");
const fileList = document.getElementById("file-list");
const fileSearchInput = document.getElementById("file-search-input");
const fileFilters = document.getElementById("file-filters");
const calendarTitle = document.getElementById("calendar-title");
const calendarGrid = document.getElementById("calendar-grid");
const calendarPrev = document.getElementById("calendar-prev");
const calendarNext = document.getElementById("calendar-next");
const profileForm = document.getElementById("profile-form");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const settingsAvatar = document.getElementById("settings-avatar");
const currentUserPill = document.getElementById("current-user-pill");
const logoutButton = document.getElementById("logout-button");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_UID_KEY);
    window.location.href = "dist/index.html";
    return;
  }

  currentAuthUser = user;
  currentProfile = await loadProfile(user.uid);

  if (!currentProfile) {
    renderFatalState("Your Firebase profile was not found. Please log out and sign in again.");
    return;
  }

  localStorage.setItem(SESSION_KEY, currentProfile.email);
  localStorage.setItem(SESSION_UID_KEY, user.uid);
  hydrateUserUi();
  attachRealtimeListeners();
  renderFiles();
  renderCalendar();
  renderThread();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => setView(item.dataset.view));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setView(item.dataset.view);
    }
  });
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendConnectionRequest(searchInput.value);
});

searchInput.addEventListener("input", () => {
  searchResults.innerHTML = "";
});

copyCodeButton.addEventListener("click", async () => {
  if (!currentProfile?.code) {
    return;
  }

  await navigator.clipboard.writeText(currentProfile.code);
  copyCodeButton.textContent = "Copied";
  setTimeout(() => {
    copyCodeButton.textContent = currentProfile.code;
  }, 1200);
});

requestList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-request-id]");
  if (!button) {
    return;
  }

  await acceptConnectionRequest(button.dataset.requestId);
});

conversationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation-id]");
  if (!button) {
    return;
  }

  activeConversation = conversations.find((conversation) => conversation.id === button.dataset.conversationId);
  renderConversations();
  renderThread();
  subscribeMessages(activeConversation.id);
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text || !activeConversation) {
    return;
  }

  messageInput.value = "";
  await addDoc(collection(db, "conversations", activeConversation.id, "messages"), {
    text,
    senderUid: currentAuthUser.uid,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "conversations", activeConversation.id), {
    lastMessage: text,
    lastMessageAt: serverTimestamp()
  });
});

fileSearchInput.addEventListener("input", renderFiles);

fileFilters.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-tag");
  if (!button) {
    return;
  }

  activeFileFilter = button.dataset.filter;
  fileFilters.querySelectorAll(".filter-tag").forEach((tag) => tag.classList.remove("active"));
  button.classList.add("active");
  renderFiles();
});

calendarPrev.addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  renderCalendar();
});

calendarNext.addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  renderCalendar();
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = profileName.value.trim() || currentProfile.name;
  currentProfile = {
    ...currentProfile,
    name,
    initials: initials(name)
  };
  await setDoc(doc(db, "users", currentAuthUser.uid), {
    name: currentProfile.name,
    initials: currentProfile.initials
  }, { merge: true });
  hydrateUserUi();
});

logoutButton.addEventListener("click", logout);
logoutButton.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    logout();
  }
});

threadHeader.addEventListener("click", (event) => {
  if (!event.target.closest(".mobile-back")) {
    return;
  }

  activeConversation = null;
  if (messageUnsubscribe) {
    messageUnsubscribe();
    messageUnsubscribe = null;
  }
  renderConversations();
  renderThread();
});

async function loadProfile(uid) {
  const profileSnap = await getDoc(doc(db, "users", uid));
  return profileSnap.exists() ? profileSnap.data() : null;
}

function attachRealtimeListeners() {
  onSnapshot(
    query(collection(db, "connectionRequests"), where("receiverUid", "==", currentAuthUser.uid), where("status", "==", "pending")),
    (snapshot) => {
      requests = snapshot.docs.map((requestDoc) => ({
        id: requestDoc.id,
        ...requestDoc.data()
      }));
      renderRequests();
    }
  );

  onSnapshot(
    query(collection(db, "conversations"), where("participants", "array-contains", currentAuthUser.uid)),
    (snapshot) => {
      conversations = snapshot.docs.map((conversationDoc) => ({
        id: conversationDoc.id,
        ...conversationDoc.data()
      })).sort((a, b) => timestampMillis(b.lastMessageAt || b.createdAt) - timestampMillis(a.lastMessageAt || a.createdAt));

      renderConversations();
      renderContacts();

      if (activeConversation) {
        activeConversation = conversations.find((conversation) => conversation.id === activeConversation.id) || activeConversation;
        renderThread();
      }
    }
  );
}

async function sendConnectionRequest(rawCode) {
  const code = normalizeCode(rawCode);

  if (!code) {
    renderSearchMessage("Enter a user code first.");
    return;
  }

  if (code === currentProfile.code) {
    renderSearchMessage("This is your own code.");
    return;
  }

  renderSearchMessage("Checking code...");

  const codeSnap = await getDoc(doc(db, "userCodes", code));
  if (!codeSnap.exists()) {
    renderSearchMessage("No user found for this code.");
    return;
  }

  const receiverUid = codeSnap.data().uid;
  const receiverSnap = await getDoc(doc(db, "users", receiverUid));

  if (!receiverSnap.exists()) {
    renderSearchMessage("That code exists, but the user profile is missing.");
    return;
  }

  const existingConversation = conversations.find((conversation) => conversation.participants.includes(receiverUid));
  if (existingConversation) {
    activeConversation = existingConversation;
    renderConversations();
    renderThread();
    subscribeMessages(existingConversation.id);
    renderSearchMessage("You are already connected.");
    return;
  }

  const requestId = `${currentAuthUser.uid}_${receiverUid}`;
  const reverseRequestId = `${receiverUid}_${currentAuthUser.uid}`;
  const reverseRequest = await getDoc(doc(db, "connectionRequests", reverseRequestId));

  if (reverseRequest.exists() && reverseRequest.data().status === "pending") {
    await acceptConnectionRequest(reverseRequestId);
    renderSearchMessage("Request accepted. Chat created.");
    searchInput.value = "";
    return;
  }

  await setDoc(doc(db, "connectionRequests", requestId), {
    senderUid: currentAuthUser.uid,
    senderName: currentProfile.name,
    senderCode: currentProfile.code,
    senderInitials: currentProfile.initials,
    receiverUid,
    receiverName: receiverSnap.data().name,
    receiverCode: receiverSnap.data().code,
    receiverInitials: receiverSnap.data().initials,
    status: "pending",
    createdAt: serverTimestamp()
  }, { merge: true });

  searchInput.value = "";
  renderSearchMessage(`Request sent to ${receiverSnap.data().name}.`);
}

async function acceptConnectionRequest(requestId) {
  const requestRef = doc(db, "connectionRequests", requestId);
  const requestSnap = await getDoc(requestRef);

  if (!requestSnap.exists()) {
    return;
  }

  const request = requestSnap.data();
  if (request.receiverUid !== currentAuthUser.uid || request.status !== "pending") {
    return;
  }

  const conversationId = createConversationId(request.senderUid, request.receiverUid);
  const participantInfo = {
    [request.senderUid]: {
      uid: request.senderUid,
      name: request.senderName,
      initials: request.senderInitials,
      code: request.senderCode
    },
    [request.receiverUid]: {
      uid: request.receiverUid,
      name: request.receiverName || currentProfile.name,
      initials: request.receiverInitials || currentProfile.initials,
      code: request.receiverCode || currentProfile.code
    }
  };

  await setDoc(doc(db, "conversations", conversationId), {
    participants: [request.senderUid, request.receiverUid],
    participantInfo,
    createdAt: serverTimestamp(),
    lastMessage: "",
    lastMessageAt: serverTimestamp()
  }, { merge: true });

  await updateDoc(requestRef, {
    status: "accepted",
    conversationId,
    acceptedAt: serverTimestamp()
  });

  activeConversation = {
    id: conversationId,
    participants: [request.senderUid, request.receiverUid],
    participantInfo,
    lastMessage: ""
  };
  subscribeMessages(conversationId);
  setView("messages");
}

function subscribeMessages(conversationId) {
  if (messageUnsubscribe) {
    messageUnsubscribe();
  }

  messageUnsubscribe = onSnapshot(
    query(collection(db, "conversations", conversationId, "messages"), orderBy("createdAt", "asc")),
    (snapshot) => {
      const messages = snapshot.docs.map((messageDoc) => ({
        id: messageDoc.id,
        ...messageDoc.data()
      }));
      renderMessages(messages);
    }
  );
}

function renderRequests() {
  if (!requests.length) {
    requestList.innerHTML = "";
    return;
  }

  requestList.innerHTML = `
    <h2 class="section-label">Requests</h2>
    ${requests.map((request) => `
      <div class="request-row">
        <span class="contact-avatar">${escapeHtml(request.senderInitials || initials(request.senderName || "LC"))}</span>
        <span class="contact-meta">
          <strong>${escapeHtml(request.senderName || "Unknown user")}</strong>
          <span>${escapeHtml(request.senderCode || "")}</span>
        </span>
        <button class="btn request-accept" type="button" data-request-id="${request.id}">Accept</button>
      </div>
    `).join("")}
  `;
}

function renderConversations() {
  if (!conversations.length) {
    conversationList.innerHTML = '<div class="empty-state"><p>No chats yet.</p></div>';
    return;
  }

  conversationList.innerHTML = conversations.map((conversation) => {
    const contact = getConversationContact(conversation);
    const preview = conversation.lastMessage || "Connected. Say hello.";
    const activeClass = conversation.id === activeConversation?.id ? " active" : "";

    return `
      <button class="conversation-row${activeClass}" type="button" data-conversation-id="${conversation.id}">
        <span class="contact-avatar">${escapeHtml(contact.initials)}</span>
        <span class="contact-meta">
          <strong>${escapeHtml(contact.name)}</strong>
          <span>${escapeHtml(preview)}</span>
        </span>
      </button>
    `;
  }).join("");
}

function renderContacts() {
  if (!conversations.length) {
    contactsGrid.innerHTML = `
      <div class="empty-state">
        <h3>No contacts yet</h3>
        <p>Send a connection request using someone&apos;s code. Accepted users appear here.</p>
      </div>
    `;
    return;
  }

  contactsGrid.innerHTML = conversations.map((conversation) => {
    const contact = getConversationContact(conversation);

    return `
      <button class="contact-card" type="button" data-conversation-id="${conversation.id}">
        <span class="contact-avatar">${escapeHtml(contact.initials)}</span>
        <span class="contact-meta">
          <strong>${escapeHtml(contact.name)}</strong>
          <span>${escapeHtml(contact.code || "")}</span>
        </span>
      </button>
    `;
  }).join("");

  contactsGrid.querySelectorAll("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeConversation = conversations.find((conversation) => conversation.id === button.dataset.conversationId);
      setView("messages");
      renderThread();
      subscribeMessages(activeConversation.id);
    });
  });
}

function renderThread() {
  if (!activeConversation) {
    threadHeader.innerHTML = `
      <div>
        <p class="eyebrow">No chat selected</p>
        <h2>Search to begin</h2>
      </div>
    `;
    messageFeed.innerHTML = `
      <div class="empty-state">
        <h3>Your account is blank</h3>
        <p>Enter a user code, send a request, and chat after they accept.</p>
      </div>
    `;
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageForm.classList.add("is-disabled");
    document.body.classList.remove("has-active-chat");
    messageInput.placeholder = "Connect with a user before typing";
    return;
  }

  const contact = getConversationContact(activeConversation);
  threadHeader.innerHTML = `
    <button class="mobile-back" type="button" aria-label="Back to chats">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"></path></svg>
    </button>
    <div>
      <p class="eyebrow">${escapeHtml(contact.code || "Connected")}</p>
      <h2>${escapeHtml(contact.name)}</h2>
    </div>
    <span class="contact-avatar">${escapeHtml(contact.initials)}</span>
  `;

  messageInput.disabled = false;
  sendButton.disabled = false;
  messageForm.classList.remove("is-disabled");
  document.body.classList.add("has-active-chat");
  messageInput.placeholder = `Message ${contact.name}`;
}

function renderMessages(messages) {
  if (!messages.length) {
    messageFeed.innerHTML = `
      <div class="empty-state">
        <h3>No messages yet</h3>
        <p>This conversation is ready.</p>
      </div>
    `;
    return;
  }

  messageFeed.innerHTML = messages.map((message) => `
    <div class="message-bubble ${message.senderUid === currentAuthUser.uid ? "me" : ""}">
      ${escapeHtml(message.text)}
      <span class="time">${formatTime(message.createdAt)}</span>
    </div>
  `).join("");
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function renderFiles() {
  const files = currentProfile?.files || [];
  const queryText = fileSearchInput.value.trim().toLowerCase();
  const visibleFiles = files.filter((file) => {
    const matchesFilter = activeFileFilter === "all" || file.type === activeFileFilter;
    const matchesSearch = !queryText || `${file.name} ${file.owner} ${file.space} ${file.type}`.toLowerCase().includes(queryText);
    return matchesFilter && matchesSearch;
  });

  if (!visibleFiles.length) {
    const emptyTitle = files.length ? "No files found" : "No files yet";
    const emptyText = files.length
      ? "Try another file type or search term."
      : "Shared files will appear here after you send or receive them.";
    fileList.innerHTML = `<div class="empty-state"><h3>${emptyTitle}</h3><p>${emptyText}</p></div>`;
    return;
  }

  fileList.innerHTML = visibleFiles.map((file) => `
    <article class="file-row">
      <div class="file-icon ${escapeHtml(file.type)}">${escapeHtml(file.type.toUpperCase())}</div>
      <div class="file-details">
        <span class="file-name">${escapeHtml(file.name)}</span>
        <span class="file-author">${escapeHtml(file.owner)}</span>
      </div>
      <span class="file-team">${escapeHtml(file.space)}</span>
      <span class="file-size">${escapeHtml(file.size)}</span>
      <span class="file-time">${escapeHtml(file.time)}</span>
      <div class="file-actions">
        <button type="button" aria-label="Download ${escapeHtml(file.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
        </button>
      </div>
    </article>
  `).join("");
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const monthEvents = currentProfile?.events || [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  calendarTitle.textContent = new Intl.DateTimeFormat([], {
    month: "long",
    year: "numeric"
  }).format(firstDay);

  const cells = dayNames.map((day) => `<div class="cal-day-name">${day}</div>`);

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + index);
    const isoDate = toIsoDate(cellDate);
    const eventsForDay = monthEvents.filter((event) => event.date === isoDate);
    const isCurrentMonth = cellDate.getMonth() === month;
    const isToday = toIsoDate(cellDate) === toIsoDate(today);

    cells.push(`
      <div class="cal-day ${isCurrentMonth ? "is-current" : ""} ${isToday ? "is-today" : ""}">
        <span class="cal-number">${cellDate.getDate()}</span>
        ${eventsForDay.map((event) => `<div class="cal-event-pill">${escapeHtml(event.title)}</div>`).join("")}
      </div>
    `);
  }

  calendarGrid.innerHTML = cells.join("");
}

function hydrateUserUi() {
  currentUserPill.textContent = currentProfile.initials || initials(currentProfile.name || currentProfile.email);
  settingsAvatar.textContent = currentUserPill.textContent;
  profileName.value = currentProfile.name || "";
  profileEmail.value = currentProfile.email || "";
  copyCodeButton.textContent = currentProfile.code || "No code";
}

function setView(viewName) {
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  if (viewName !== "messages") {
    document.body.classList.remove("has-active-chat");
  } else if (activeConversation) {
    document.body.classList.add("has-active-chat");
  }

  viewSections.forEach((section) => {
    const isActive = section.id === `view-${viewName}`;
    section.classList.toggle("hidden", !isActive);
    section.classList.toggle("active", isActive);
  });
}

function getConversationContact(conversation) {
  const otherUid = conversation.participants.find((uid) => uid !== currentAuthUser.uid);
  const contact = conversation.participantInfo?.[otherUid] || {};
  return {
    uid: otherUid,
    name: contact.name || "Connected user",
    initials: contact.initials || initials(contact.name || "LC"),
    code: contact.code || ""
  };
}

function createConversationId(firstUid, secondUid) {
  return [firstUid, secondUid].sort().join("_");
}

function normalizeCode(value) {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) {
    return "";
  }
  return cleaned.startsWith("LC-") ? cleaned : `LC-${cleaned.replace(/^LC-?/, "")}`;
}

function renderSearchMessage(message) {
  searchResults.innerHTML = `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function renderFatalState(message) {
  messageFeed.innerHTML = `<div class="empty-state"><h3>Can&apos;t load chat</h3><p>${escapeHtml(message)}</p></div>`;
}

function timestampMillis(value) {
  if (!value) {
    return 0;
  }
  return typeof value.toMillis === "function" ? value.toMillis() : new Date(value).getTime();
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function initials(value) {
  return value
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "LC";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

async function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_UID_KEY);
  await signOut(auth);
  window.location.href = "dist/index.html";
}
