/* ============================================================
   PHNX — App Logic
   ============================================================ */

const API = '';          // Flask runs on same origin
let currentUser  = null;
let currentPage  = 1;
let totalThreads = 0;
let isLoading    = false;
const LIMIT      = 20;

/* ─── Init ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupNavigation();
});

async function checkAuth() {
  try {
    const res  = await fetch(`${API}/api/me`, { credentials: 'include' });
    if (res.ok) {
      currentUser = await res.json();
      enterApp();
    } else {
      showAuthOverlay();
    }
  } catch {
    showAuthOverlay();
  }
}

/* ─── Auth Overlay ──────────────────────────────────────────── */
function showAuthOverlay() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function enterApp() {
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  populateSidebar();
  loadFeed(true);
}

function switchTab(tab) {
  const loginForm  = document.getElementById('login-form');
  const regForm    = document.getElementById('register-form');
  const tabLogin   = document.getElementById('tab-login');
  const tabReg     = document.getElementById('tab-register');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
  } else {
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    tabReg.classList.add('active');
    tabLogin.classList.remove('active');
  }
  clearErrors();
}

/* ─── Login ─────────────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  clearErrors();
  setLoading(btn, true);

  try {
    const res  = await fetch(`${API}/api/login`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    currentUser = data.user;
    enterApp();
    showToast('Welcome back, @' + currentUser.username + '!', 'success');
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ─── Register ──────────────────────────────────────────────── */
async function handleRegister(e) {
  e.preventDefault();
  const btn      = document.getElementById('register-btn');
  const errEl    = document.getElementById('register-error');
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  clearErrors();
  setLoading(btn, true);

  try {
    const res  = await fetch(`${API}/api/register`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    currentUser = data.user;
    enterApp();
    showToast('Account created! Welcome, @' + currentUser.username + ' 🎉', 'success');
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ─── Logout ─────────────────────────────────────────────────── */
async function handleLogout() {
  await fetch(`${API}/api/logout`, { method: 'POST', credentials: 'include' });
  currentUser = null;
  currentPage = 1;
  totalThreads = 0;
  document.getElementById('threads-feed').innerHTML = '';
  showAuthOverlay();
  showToast('Logged out', 'success');
}

/* ─── Sidebar ────────────────────────────────────────────────── */
function populateSidebar() {
  if (!currentUser) return;
  const avatar   = currentUser.avatar || `https://api.dicebear.com/7.x/lorelei/svg?seed=${currentUser.username}`;
  document.getElementById('sidebar-avatar').src  = avatar;
  document.getElementById('sidebar-username').textContent = '@' + currentUser.username;
  document.getElementById('compose-avatar').src  = avatar;
  document.getElementById('profile-avatar').src  = avatar;
  document.getElementById('profile-username').textContent = currentUser.username;
  document.getElementById('profile-handle').textContent   = '@' + currentUser.username;
}

/* ─── Navigation ─────────────────────────────────────────────── */
function setupNavigation() {
  document.getElementById('nav-feed').addEventListener('click', e => {
    e.preventDefault();
    switchView('feed');
  });
  document.getElementById('nav-profile').addEventListener('click', e => {
    e.preventDefault();
    switchView('profile');
    loadProfileThreads();
  });
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.getElementById(`nav-${view}`).classList.add('active');
}

/* ─── Feed ───────────────────────────────────────────────────── */
async function loadFeed(reset = false) {
  if (isLoading) return;
  if (reset) {
    currentPage  = 1;
    totalThreads = 0;
    document.getElementById('threads-feed').innerHTML = '';
    document.getElementById('feed-loading').classList.remove('hidden');
    document.getElementById('load-more-wrap').classList.add('hidden');
  }

  isLoading = true;

  try {
    const res  = await fetch(`${API}/api/threads?page=${currentPage}&limit=${LIMIT}`, {
      credentials: 'include'
    });
    const data = await res.json();
    totalThreads = data.total;
    document.getElementById('feed-loading').classList.add('hidden');

    const feed = document.getElementById('threads-feed');

    if (data.threads.length === 0 && currentPage === 1) {
      feed.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">✨</span>
          <p>No threads yet. Be the first to post!</p>
        </div>`;
    } else {
      data.threads.forEach(t => feed.appendChild(buildThreadCard(t)));
    }

    // Show or hide Load More
    const loaded = (currentPage - 1) * LIMIT + data.threads.length;
    if (loaded < totalThreads) {
      document.getElementById('load-more-wrap').classList.remove('hidden');
    } else {
      document.getElementById('load-more-wrap').classList.add('hidden');
    }
    currentPage++;
  } catch (err) {
    console.error(err);
    document.getElementById('feed-loading').classList.add('hidden');
    showToast('Failed to load threads', 'error');
  } finally {
    isLoading = false;
  }
}

async function loadMore() {
  await loadFeed(false);
}

/* ─── Post Thread ────────────────────────────────────────────── */
async function postThread() {
  const input   = document.getElementById('compose-input');
  const content = input.value.trim();

  if (!content) return showToast('Write something first!', 'error');
  if (content.length > 500) return showToast('Too long! Max 500 characters.', 'error');

  const btn = document.getElementById('post-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="btn-spinner"></div>`;

  try {
    const res  = await fetch(`${API}/api/threads`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Post failed');

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('char-count').textContent = '500';
    document.getElementById('char-count').className = 'char-count';

    // Inject at top of feed
    const feed = document.getElementById('threads-feed');
    const empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();
    feed.insertBefore(buildThreadCard(data), feed.firstChild);
    totalThreads++;

    showToast('Thread posted! 🚀', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Post</span>';
  }
}

/* ─── Like ───────────────────────────────────────────────────── */
async function toggleLike(threadId, btn) {
  if (!currentUser) return showToast('Sign in to like threads', 'error');

  const countEl = btn.querySelector('.like-count');
  const isLiked = btn.classList.contains('liked');

  // Optimistic
  btn.classList.toggle('liked');
  countEl.textContent = parseInt(countEl.textContent) + (isLiked ? -1 : 1);

  try {
    const res  = await fetch(`${API}/api/threads/${threadId}/like`, {
      method: 'POST', credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    countEl.textContent = data.like_count;
    if (data.liked) btn.classList.add('liked'); else btn.classList.remove('liked');
  } catch {
    // Revert
    btn.classList.toggle('liked');
    countEl.textContent = parseInt(countEl.textContent) + (isLiked ? 1 : -1);
    showToast('Could not toggle like', 'error');
  }
}

/* ─── Delete Thread ──────────────────────────────────────────── */
async function deleteThread(threadId, cardEl) {
  if (!confirm('Delete this thread?')) return;

  try {
    const res  = await fetch(`${API}/api/threads/${threadId}`, {
      method: 'DELETE', credentials: 'include'
    });
    if (!res.ok) throw new Error('Delete failed');
    cardEl.style.transition = 'all 0.3s ease';
    cardEl.style.opacity    = '0';
    cardEl.style.transform  = 'translateX(-20px)';
    setTimeout(() => cardEl.remove(), 300);
    showToast('Thread deleted', 'success');
    totalThreads--;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Profile Threads ────────────────────────────────────────── */
async function loadProfileThreads() {
  const container = document.getElementById('profile-threads');
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading…</p></div>`;

  try {
    const res   = await fetch(`${API}/api/threads?limit=100`, { credentials: 'include' });
    const data  = await res.json();
    const mine  = data.threads.filter(t => t.user_id === currentUser.id);

    document.getElementById('stat-threads').textContent = mine.length;

    container.innerHTML = '';
    if (mine.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">📝</span><p>No threads yet. Share something!</p></div>`;
    } else {
      mine.forEach(t => container.appendChild(buildThreadCard(t)));
    }
  } catch {
    container.innerHTML = `<div class="empty-state"><p>Failed to load threads.</p></div>`;
  }
}

/* ─── Build Thread Card ──────────────────────────────────────── */
function buildThreadCard(thread) {
  const isOwn  = currentUser && thread.user_id === currentUser.id;
  const card   = document.createElement('div');
  card.className = 'thread-card';
  card.id        = `thread-${thread.id}`;

  card.innerHTML = `
    <div class="thread-avatar-wrap">
      <img class="thread-avatar" src="${thread.avatar}" alt="${thread.username}" loading="lazy"/>
    </div>
    <div class="thread-body">
      <div class="thread-header">
        <span class="thread-username">@${escHtml(thread.username)}</span>
        <span class="thread-time">${formatTime(thread.created_at)}</span>
      </div>
      <p class="thread-content">${escHtml(thread.content)}</p>
      <div class="thread-actions">
        <button class="action-btn like-btn ${thread.liked ? 'liked' : ''}"
                id="like-btn-${thread.id}"
                onclick="toggleLike(${thread.id}, this)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${thread.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
          </svg>
          <span class="like-count">${thread.like_count}</span>
        </button>
        ${isOwn ? `
          <button class="action-btn delete-btn" onclick="deleteThread(${thread.id}, document.getElementById('thread-${thread.id}'))" title="Delete thread">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
            </svg>
          </button>` : ''}
      </div>
    </div>`;

  return card;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function updateCharCount(el) {
  const remaining = 500 - el.value.length;
  const el2 = document.getElementById('char-count');
  el2.textContent = remaining;
  el2.className = 'char-count' + (remaining < 50 ? (remaining < 20 ? ' danger' : ' warning') : '');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d   = new Date(isoStr.replace(' ', 'T') + 'Z');
  const now  = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800)return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  const span    = btn.querySelector('span');
  const spinner = btn.querySelector('.btn-spinner');
  if (loading) {
    span?.classList.add('hidden');
    spinner?.classList.remove('hidden');
  } else {
    span?.classList.remove('hidden');
    spinner?.classList.add('hidden');
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.add('hidden');
    el.textContent = '';
  });
}

let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  toast.className = `toast ${type}`;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}
