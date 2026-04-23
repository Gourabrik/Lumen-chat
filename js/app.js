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
    window.location.href = "login.html";
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
  if (!currentProfile || !currentProfile.code) {
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
  fileFilters.querySelectorAll(".filter-tag").forEach((tag) => {
    tag.classList.remove("active", "btn-primary");
    tag.classList.add("btn-outline-primary");
  });
  button.classList.add("active", "btn-primary");
  button.classList.remove("btn-outline-primary");
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
  currentProfile = Object.assign({}, currentProfile, {
    name,
    initials: initials(name)
  });
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
      requests = snapshot.docs.map((requestDoc) => Object.assign({
        id: requestDoc.id
      }, requestDoc.data()));
      renderRequests();
    }
  );

  onSnapshot(
    query(collection(db, "conversations"), where("participants", "array-contains", currentAuthUser.uid)),
    (snapshot) => {
      conversations = snapshot.docs.map((conversationDoc) => Object.assign({
        id: conversationDoc.id
      }, conversationDoc.data())).sort((a, b) => timestampMillis(b.lastMessageAt || b.createdAt) - timestampMillis(a.lastMessageAt || a.createdAt));

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
      const messages = snapshot.docs.map((messageDoc) => Object.assign({
        id: messageDoc.id
      }, messageDoc.data()));
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
    <div class="mb-2 text-uppercase text-secondary small fw-semibold">Requests</div>
    <div class="d-grid gap-2">
      ${requests.map((request) => `
        <div class="card border-0 bg-body-tertiary">
          <div class="card-body d-flex align-items-center gap-3">
            <span class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0" style="width:42px;height:42px;">
              ${escapeHtml(request.senderInitials || initials(request.senderName || "LC"))}
            </span>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${escapeHtml(request.senderName || "Unknown user")}</div>
              <small class="text-secondary">${escapeHtml(request.senderCode || "")}</small>
            </div>
            <button class="btn btn-primary btn-sm" type="button" data-request-id="${request.id}">Accept</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderConversations() {
  if (!conversations.length) {
    conversationList.innerHTML = `
      <div class="alert alert-light border text-center mb-0">
        <p class="mb-0">No chats yet.</p>
      </div>
    `;
    return;
  }

  conversationList.innerHTML = conversations.map((conversation) => {
    const contact = getConversationContact(conversation);
    const preview = conversation.lastMessage || "Connected. Say hello.";
    const isActive = activeConversation ? conversation.id === activeConversation.id : false;

    return `
      <button class="btn ${isActive ? "btn-primary" : "btn-outline-secondary"} text-start w-100 rounded-4 p-3" type="button" data-conversation-id="${conversation.id}">
        <div class="d-flex align-items-center gap-3">
          <span class="rounded-circle ${isActive ? "bg-white text-primary" : "bg-primary text-white"} d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0" style="width:44px;height:44px;">
            ${escapeHtml(contact.initials)}
          </span>
          <span class="flex-grow-1 min-w-0">
            <span class="d-block fw-semibold text-truncate">${escapeHtml(contact.name)}</span>
            <small class="${isActive ? "text-white-50" : "text-secondary"} d-block text-truncate">${escapeHtml(preview)}</small>
          </span>
        </div>
      </button>
    `;
  }).join("");
}

function renderContacts() {
  if (!conversations.length) {
    contactsGrid.innerHTML = `
      <div class="col-12">
        <div class="alert alert-light border text-center mb-0">
          <h3 class="h5">No contacts yet</h3>
          <p class="mb-0">Send a connection request using someone's code. Accepted users appear here.</p>
        </div>
      </div>
    `;
    return;
  }

  contactsGrid.innerHTML = conversations.map((conversation) => {
    const contact = getConversationContact(conversation);

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <button class="btn btn-outline-secondary text-start w-100 h-100 rounded-4 p-3" type="button" data-conversation-id="${conversation.id}">
          <div class="d-flex align-items-center gap-3">
            <span class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0" style="width:46px;height:46px;">
              ${escapeHtml(contact.initials)}
            </span>
            <span class="min-w-0">
              <span class="d-block fw-semibold text-truncate">${escapeHtml(contact.name)}</span>
              <small class="text-secondary">${escapeHtml(contact.code || "")}</small>
            </span>
          </div>
        </button>
      </div>
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
        <p class="text-uppercase text-secondary small fw-semibold mb-1">No chat selected</p>
        <h2 class="h4 mb-0">Search to begin</h2>
      </div>
    `;
    messageFeed.innerHTML = `
      <div class="alert alert-light border text-center py-5 mb-0">
        <h3 class="h5">Your account is blank</h3>
        <p class="mb-0 text-secondary">Enter a user code, send a request, and chat after they accept.</p>
      </div>
    `;
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageForm.classList.add("opacity-50");
    messageInput.placeholder = "Connect with a user before typing";
    return;
  }

  const contact = getConversationContact(activeConversation);
  threadHeader.innerHTML = `
    <div class="d-flex align-items-center justify-content-between gap-3">
      <div class="d-flex align-items-center gap-3">
        <button class="btn btn-outline-secondary rounded-circle mobile-back" type="button" aria-label="Back to chats">←</button>
        <div>
          <p class="text-uppercase text-secondary small fw-semibold mb-1">${escapeHtml(contact.code || "Connected")}</p>
          <h2 class="h4 mb-0">${escapeHtml(contact.name)}</h2>
        </div>
      </div>
      <span class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0" style="width:46px;height:46px;">
        ${escapeHtml(contact.initials)}
      </span>
    </div>
  `;

  messageInput.disabled = false;
  sendButton.disabled = false;
  messageForm.classList.remove("opacity-50");
  messageInput.placeholder = `Message ${contact.name}`;
}

function renderMessages(messages) {
  if (!messages.length) {
    messageFeed.innerHTML = `
      <div class="alert alert-light border text-center py-5 mb-0">
        <h3 class="h5">No messages yet</h3>
        <p class="mb-0 text-secondary">This conversation is ready.</p>
      </div>
    `;
    return;
  }

  messageFeed.innerHTML = messages.map((message) => {
    const isMine = message.senderUid === currentAuthUser.uid;

    return `
      <div class="d-flex ${isMine ? "justify-content-end" : "justify-content-start"}">
        <div class="card border-0 shadow-sm ${isMine ? "bg-primary text-white" : "bg-white"}" style="max-width:min(78%, 38rem);">
          <div class="card-body py-3 px-3">
            <div>${escapeHtml(message.text)}</div>
            <div class="small mt-2 ${isMine ? "text-white-50" : "text-secondary"}">${formatTime(message.createdAt)}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function renderFiles() {
  const files = currentProfile && currentProfile.files ? currentProfile.files : [];
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
    fileList.innerHTML = `
      <div class="alert alert-light border text-center mb-0">
        <h3 class="h5">${emptyTitle}</h3>
        <p class="mb-0 text-secondary">${emptyText}</p>
      </div>
    `;
    return;
  }

  fileList.innerHTML = visibleFiles.map((file) => `
    <div class="card border-0 shadow-sm rounded-4">
      <div class="card-body">
        <div class="row align-items-center g-3">
          <div class="col-12 col-md-auto">
            <span class="badge text-bg-primary px-3 py-2 text-uppercase">${escapeHtml(file.type.toUpperCase())}</span>
          </div>
          <div class="col-12 col-md">
            <div class="fw-semibold">${escapeHtml(file.name)}</div>
            <div class="text-secondary small">${escapeHtml(file.owner)}</div>
          </div>
          <div class="col-6 col-md-auto">
            <div class="small text-secondary">Space</div>
            <div>${escapeHtml(file.space)}</div>
          </div>
          <div class="col-6 col-md-auto">
            <div class="small text-secondary">Size</div>
            <div>${escapeHtml(file.size)}</div>
          </div>
          <div class="col-6 col-md-auto">
            <div class="small text-secondary">Time</div>
            <div>${escapeHtml(file.time)}</div>
          </div>
          <div class="col-6 col-md-auto">
            <button type="button" class="btn btn-outline-primary w-100" aria-label="Download ${escapeHtml(file.name)}">Download</button>
          </div>
        </div>
      </div>
    </div>
  `).join("");
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const monthEvents = currentProfile && currentProfile.events ? currentProfile.events : [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  calendarTitle.textContent = new Intl.DateTimeFormat([], {
    month: "long",
    year: "numeric"
  }).format(firstDay);

  const weeks = [];

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const days = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const offset = weekIndex * 7 + dayIndex;
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + offset);
      const isoDate = toIsoDate(cellDate);
      const eventsForDay = monthEvents.filter((event) => event.date === isoDate);
      const isCurrentMonth = cellDate.getMonth() === month;
      const isToday = toIsoDate(cellDate) === toIsoDate(today);

      days.push(`
        <td class="${isCurrentMonth ? "" : "text-secondary bg-light"} ${isToday ? "border-primary border-2" : ""}" style="vertical-align: top; min-width: 120px; height: 110px;">
          <div class="fw-semibold mb-2">${cellDate.getDate()}</div>
          <div class="d-grid gap-1">
            ${eventsForDay.map((event) => `<span class="badge text-bg-primary text-start text-wrap">${escapeHtml(event.title)}</span>`).join("")}
          </div>
        </td>
      `);
    }

    weeks.push(`<tr>${days.join("")}</tr>`);
  }

  calendarGrid.innerHTML = `
    <div class="table-responsive">
      <table class="table table-bordered align-middle bg-white mb-0">
        <thead class="table-light">
          <tr>
            ${dayNames.map((day) => `<th class="text-center text-uppercase small">${day}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${weeks.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function hydrateUserUi() {
  currentUserPill.textContent = currentProfile.initials || initials(currentProfile.name || currentProfile.email);
  settingsAvatar.textContent = currentUserPill.textContent;
  profileName.value = currentProfile.name || "";
  profileEmail.value = currentProfile.email || "";
  copyCodeButton.textContent = currentProfile.code || "No code";
}

function setView(viewName) {
  navItems.forEach((item) => {
    const isActive = item.dataset.view === viewName;
    item.classList.toggle("active", isActive);

    const button = item.querySelector("button");
    if (button) {
      const parentNav = item.closest("nav");
      if (parentNav && parentNav.classList.contains("bg-dark")) {
        button.classList.toggle("btn-light", isActive);
        button.classList.toggle("text-dark", isActive);
        button.classList.toggle("btn-dark", !isActive);
      } else {
        button.classList.toggle("btn-primary", isActive);
        button.classList.toggle("btn-outline-primary", !isActive);
      }
    }
  });

  viewSections.forEach((section) => {
    const isActive = section.id === `view-${viewName}`;
    section.classList.toggle("d-none", !isActive);
  });
}

function getConversationContact(conversation) {
  const otherUid = conversation.participants.find((uid) => uid !== currentAuthUser.uid);
  const contact = conversation.participantInfo && conversation.participantInfo[otherUid] ? conversation.participantInfo[otherUid] : {};
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
  searchResults.innerHTML = `
    <div class="alert alert-info mb-0" role="status">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderFatalState(message) {
  messageFeed.innerHTML = `
    <div class="alert alert-danger mb-0">
      <h3 class="h5">Can't load chat</h3>
      <p class="mb-0">${escapeHtml(message)}</p>
    </div>
  `;
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
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return String.fromCharCode(38, 97, 109, 112, 59);
      case "<":
        return String.fromCharCode(38, 108, 116, 59);
      case ">":
        return String.fromCharCode(38, 103, 116, 59);
      case '"':
        return String.fromCharCode(38, 113, 117, 111, 116, 59);
      case "'":
        return String.fromCharCode(38, 35, 48, 51, 57, 59);
      default:
        return character;
    }
  });
}

async function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_UID_KEY);
  await signOut(auth);
  window.location.href = "login.html";
}
