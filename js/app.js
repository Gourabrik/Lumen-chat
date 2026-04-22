document.addEventListener('DOMContentLoaded', () => {
  const USERS_KEY = 'lumenChatUsers';
  const SESSION_KEY = 'lumenChatSession';

  const contacts = [
    { id: 'maya', name: 'Maya Shah', role: 'Product designer', initials: 'MS' },
    { id: 'arjun', name: 'Arjun Mehta', role: 'Frontend engineer', initials: 'AM' },
    { id: 'nora', name: 'Nora Khan', role: 'Project lead', initials: 'NK' },
    { id: 'isha', name: 'Isha Rao', role: 'Customer success', initials: 'IR' },
    { id: 'dev', name: 'Dev Patel', role: 'Operations', initials: 'DP' }
  ];

  const sessionEmail = localStorage.getItem(SESSION_KEY);
  const users = readUsers();

  if (!sessionEmail || !users[sessionEmail]) {
    window.location.href = 'dist/index.html';
    return;
  }

  let currentUser = users[sessionEmail];
  currentUser.conversations = currentUser.conversations || {};
  currentUser.contacts = currentUser.contacts || [];
  currentUser.files = currentUser.files || [];
  currentUser.events = currentUser.events || [];

  let activeContactId = null;
  let activeFileFilter = 'all';
  let calendarDate = new Date();

  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const viewSections = document.querySelectorAll('.view-section');
  const searchInput = document.getElementById('chat-search-input');
  const searchResults = document.getElementById('search-results');
  const conversationList = document.getElementById('conversation-list');
  const threadHeader = document.getElementById('thread-header');
  const messageFeed = document.getElementById('message-feed');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const contactsGrid = document.getElementById('contacts-grid');
  const fileList = document.getElementById('file-list');
  const fileSearchInput = document.getElementById('file-search-input');
  const fileFilters = document.getElementById('file-filters');
  const calendarTitle = document.getElementById('calendar-title');
  const calendarGrid = document.getElementById('calendar-grid');
  const calendarPrev = document.getElementById('calendar-prev');
  const calendarNext = document.getElementById('calendar-next');
  const profileForm = document.getElementById('profile-form');
  const profileName = document.getElementById('profile-name');
  const profileEmail = document.getElementById('profile-email');
  const settingsAvatar = document.getElementById('settings-avatar');
  const currentUserPill = document.getElementById('current-user-pill');
  const logoutButton = document.getElementById('logout-button');

  hydrateUserUi();
  renderSearchResults('');
  renderConversations();
  renderContacts();
  renderFiles();
  renderCalendar();
  renderThread();

  navItems.forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.view));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setView(item.dataset.view);
      }
    });
  });

  searchInput.addEventListener('input', (event) => {
    renderSearchResults(event.target.value);
  });

  messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();

    if (!text || !activeContactId) {
      return;
    }

    const conversation = getConversation(activeContactId);
    conversation.messages.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      text,
      sender: 'me',
      createdAt: new Date().toISOString()
    });

    if (!currentUser.contacts.includes(activeContactId)) {
      currentUser.contacts.push(activeContactId);
    }

    saveCurrentUser();
    messageInput.value = '';
    renderConversations();
    renderContacts();
    renderThread();
  });

  fileSearchInput.addEventListener('input', renderFiles);

  fileFilters.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-tag');
    if (!button) {
      return;
    }

    activeFileFilter = button.dataset.filter;
    fileFilters.querySelectorAll('.filter-tag').forEach((tag) => tag.classList.remove('active'));
    button.classList.add('active');
    renderFiles();
  });

  calendarPrev.addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });

  calendarNext.addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });

  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    currentUser.name = profileName.value.trim() || currentUser.name;
    currentUser.initials = initials(currentUser.name);
    saveCurrentUser();
    hydrateUserUi();
  });

  logoutButton.addEventListener('click', logout);
  logoutButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      logout();
    }
  });

  threadHeader.addEventListener('click', (event) => {
    if (!event.target.closest('.mobile-back')) {
      return;
    }

    activeContactId = null;
    renderConversations();
    renderThread();
  });

  function readUsers() {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
  }

  function saveUsers(nextUsers) {
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
  }

  function saveCurrentUser() {
    const latestUsers = readUsers();
    latestUsers[sessionEmail] = currentUser;
    saveUsers(latestUsers);
  }

  function initials(value) {
    return value
      .split(/[ @._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || 'LC';
  }

  function setView(viewName) {
    navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
    if (viewName !== 'messages') {
      document.body.classList.remove('has-active-chat');
    } else if (activeContactId) {
      document.body.classList.add('has-active-chat');
    }

    viewSections.forEach((section) => {
      const isActive = section.id === `view-${viewName}`;
      section.classList.toggle('hidden', !isActive);
      section.classList.toggle('active', isActive);
    });
  }

  function hydrateUserUi() {
    currentUserPill.textContent = currentUser.initials || initials(currentUser.name || currentUser.email);
    settingsAvatar.textContent = currentUserPill.textContent;
    profileName.value = currentUser.name || '';
    profileEmail.value = currentUser.email || '';
  }

  function renderSearchResults(query) {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = contacts.filter((contact) => {
      if (!normalizedQuery) {
        return false;
      }

      return `${contact.name} ${contact.role}`.toLowerCase().includes(normalizedQuery);
    });

    if (!normalizedQuery) {
      searchResults.innerHTML = '';
      return;
    }

    if (!matches.length) {
      searchResults.innerHTML = '<div class="empty-state"><p>No matching people found.</p></div>';
      return;
    }

    searchResults.innerHTML = matches.map((contact) => contactButton(contact, 'contact-row')).join('');
    searchResults.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => startConversation(button.dataset.contactId));
    });
  }

  function renderContacts() {
    const savedContacts = contacts.filter((contact) => currentUser.contacts.includes(contact.id));

    if (!savedContacts.length) {
      contactsGrid.innerHTML = `
        <div class="empty-state">
          <h3>No contacts yet</h3>
          <p>Search from Messages and send a chat. People you message will appear here.</p>
        </div>
      `;
      return;
    }

    contactsGrid.innerHTML = savedContacts.map((contact) => contactButton(contact, 'contact-card')).join('');

    contactsGrid.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        setView('messages');
        startConversation(button.dataset.contactId);
      });
    });
  }

  function contactButton(contact, className) {
    return `
      <button class="${className}" type="button" data-contact-id="${contact.id}">
        <span class="contact-avatar">${contact.initials}</span>
        <span class="contact-meta">
          <strong>${contact.name}</strong>
          <span>${contact.role}</span>
        </span>
      </button>
    `;
  }

  function startConversation(contactId) {
    activeContactId = contactId;
    getConversation(contactId);
    searchInput.value = '';
    searchResults.innerHTML = '';
    renderConversations();
    renderThread();
    messageInput.focus();
  }

  function getConversation(contactId) {
    if (!currentUser.conversations) {
      currentUser.conversations = {};
    }

    if (!currentUser.conversations[contactId]) {
      currentUser.conversations[contactId] = {
        contactId,
        messages: []
      };
    }

    return currentUser.conversations[contactId];
  }

  function renderConversations() {
    const conversations = Object.values(currentUser.conversations || {})
      .filter((conversation) => conversation.messages.length);

    if (!conversations.length) {
      conversationList.innerHTML = '<div class="empty-state"><p>No chats yet.</p></div>';
      return;
    }

    conversationList.innerHTML = conversations.map((conversation) => {
      const contact = contacts.find((item) => item.id === conversation.contactId);
      if (!contact) {
        return '';
      }

      const lastMessage = conversation.messages.at(-1);
      const preview = lastMessage ? lastMessage.text : 'Ready to start';
      const activeClass = conversation.contactId === activeContactId ? ' active' : '';

      return `
        <button class="conversation-row${activeClass}" type="button" data-contact-id="${conversation.contactId}">
          <span class="contact-avatar">${contact.initials}</span>
          <span class="contact-meta">
            <strong>${contact.name}</strong>
            <span>${preview}</span>
          </span>
        </button>
      `;
    }).join('');

    conversationList.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        activeContactId = button.dataset.contactId;
        renderConversations();
        renderThread();
      });
    });
  }

  function renderThread() {
    const contact = contacts.find((item) => item.id === activeContactId);

    if (!contact) {
      threadHeader.innerHTML = `
        <div>
          <p class="eyebrow">No chat selected</p>
          <h2>Search to begin</h2>
        </div>
      `;
      messageFeed.innerHTML = `
        <div class="empty-state">
          <h3>Your account is blank</h3>
          <p>Use search to find a person. A conversation appears only after you start chatting.</p>
        </div>
      `;
      messageInput.disabled = true;
      sendButton.disabled = true;
      messageForm.classList.add('is-disabled');
      document.body.classList.remove('has-active-chat');
      messageInput.placeholder = 'Search and select a person before typing';
      return;
    }

    const conversation = getConversation(activeContactId);
    threadHeader.innerHTML = `
      <button class="mobile-back" type="button" aria-label="Back to chats">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"></path></svg>
      </button>
      <div>
        <p class="eyebrow">${contact.role}</p>
        <h2>${contact.name}</h2>
      </div>
      <span class="contact-avatar">${contact.initials}</span>
    `;

    messageInput.disabled = false;
    sendButton.disabled = false;
    messageForm.classList.remove('is-disabled');
    document.body.classList.add('has-active-chat');
    messageInput.placeholder = `Message ${contact.name}`;

    if (!conversation.messages.length) {
      messageFeed.innerHTML = `
        <div class="empty-state">
          <h3>No messages yet</h3>
          <p>Send the first message to ${contact.name}.</p>
        </div>
      `;
      return;
    }

    messageFeed.innerHTML = conversation.messages.map((message) => `
      <div class="message-bubble ${message.sender === 'me' ? 'me' : ''}">
        ${escapeHtml(message.text)}
        <span class="time">${formatTime(message.createdAt)}</span>
      </div>
    `).join('');
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  function renderFiles() {
    const files = currentUser.files || [];
    const query = fileSearchInput.value.trim().toLowerCase();
    const visibleFiles = files.filter((file) => {
      const matchesFilter = activeFileFilter === 'all' || file.type === activeFileFilter;
      const matchesSearch = !query || `${file.name} ${file.owner} ${file.space} ${file.type}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });

    if (!visibleFiles.length) {
      const emptyTitle = files.length ? 'No files found' : 'No files yet';
      const emptyText = files.length
        ? 'Try another file type or search term.'
        : 'Shared files will appear here after you send or receive them.';
      fileList.innerHTML = `<div class="empty-state"><h3>${emptyTitle}</h3><p>${emptyText}</p></div>`;
      return;
    }

    fileList.innerHTML = visibleFiles.map((file) => `
      <article class="file-row">
        <div class="file-icon ${file.type}">${file.type.toUpperCase()}</div>
        <div class="file-details">
          <span class="file-name">${file.name}</span>
          <span class="file-author">${file.owner}</span>
        </div>
        <span class="file-team">${file.space}</span>
        <span class="file-size">${file.size}</span>
        <span class="file-time">${file.time}</span>
        <div class="file-actions">
          <button type="button" aria-label="Download ${file.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
          </button>
          <button type="button" aria-label="More actions for ${file.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
          </button>
        </div>
      </article>
    `).join('');
  }

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const today = new Date();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(year, month, 1 - firstDay.getDay());
    const monthEvents = currentUser.events || [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    calendarTitle.textContent = new Intl.DateTimeFormat([], {
      month: 'long',
      year: 'numeric'
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
        <div class="cal-day ${isCurrentMonth ? 'is-current' : ''} ${isToday ? 'is-today' : ''}">
          <span class="cal-number">${cellDate.getDate()}</span>
          ${eventsForDay.map((event) => `<div class="cal-event-pill">${escapeHtml(event.title)}</div>`).join('')}
        </div>
      `);
    }

    calendarGrid.innerHTML = cells.join('');
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatTime(dateString) {
    return new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(dateString));
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'dist/index.html';
  }
});
