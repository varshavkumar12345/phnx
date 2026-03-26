/* ============================================================
   PHNX — App Logic
   ============================================================ */

const API = '';
let currentUser   = null;
let currentPage   = 1;
let totalThreads  = 0;
let isLoading     = false;
let latestId      = 0;
let pollInterval  = null;
const LIMIT       = 20;
const POLL_MS     = 3000;

/* ─── Init ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async function() {
  await checkAuth();
  loadFeed(true);
  startPolling();
  setupNavigation();
});

/* ─── Check Session ─────────────────────────────────────────── */
async function checkAuth() {
  try {
    var res = await fetch(API + '/api/me', { credentials: 'include' });
    if (res.ok) {
      currentUser = await res.json();
      onUserLoggedIn();
    } else {
      onUserGuest();
    }
  } catch (e) {
    onUserGuest();
  }
}

/* ─── UI State: Logged In ────────────────────────────────────── */
function onUserLoggedIn() {
  var avatar = (currentUser.avatar) ||
    'https://api.dicebear.com/7.x/lorelei/svg?seed=' + currentUser.username;

  document.getElementById('sidebar-user').classList.remove('hidden');
  document.getElementById('sidebar-guest').classList.add('hidden');
  document.getElementById('nav-profile').classList.remove('hidden');
  document.getElementById('sidebar-avatar').src = avatar;
  document.getElementById('sidebar-username').textContent = '@' + currentUser.username;

  document.getElementById('compose-box').classList.remove('hidden');
  document.getElementById('guest-cta').classList.add('hidden');
  document.getElementById('compose-avatar').src = avatar;

  document.getElementById('profile-avatar').src = avatar;
  document.getElementById('profile-username').textContent = currentUser.username;
  document.getElementById('profile-handle').textContent   = '@' + currentUser.username;

  switchView('feed');
}

/* ─── UI State: Guest ────────────────────────────────────────── */
function onUserGuest() {
  document.getElementById('sidebar-user').classList.add('hidden');
  document.getElementById('sidebar-guest').classList.remove('hidden');
  document.getElementById('nav-profile').classList.add('hidden');
  document.getElementById('compose-box').classList.add('hidden');
  document.getElementById('guest-cta').classList.remove('hidden');
}

/* ─── Auth Modal ─────────────────────────────────────────────── */
function openAuthModal(tab) {
  tab = tab || 'login';
  switchTab(tab);
  clearErrors();
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('auth-tagline').textContent =
    tab === 'register' ? 'Create an account to start posting' : 'Sign in to post a thread';
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function closeModalOnBackdrop(e) {
  if (e.target.id === 'auth-modal') closeAuthModal();
}

function switchTab(tab) {
  var loginForm = document.getElementById('login-form');
  var regForm   = document.getElementById('register-form');
  var tabLogin  = document.getElementById('tab-login');
  var tabReg    = document.getElementById('tab-register');

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

/* ─── Login ──────────────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  var btn      = document.getElementById('login-btn');
  var errEl    = document.getElementById('login-error');
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;

  clearErrors();
  setLoading(btn, true);

  try {
    var res  = await fetch(API + '/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    currentUser = data.user;
    closeAuthModal();
    onUserLoggedIn();
    showToast('Welcome back, @' + currentUser.username + '!', 'success');
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ─── Register ───────────────────────────────────────────────── */
async function handleRegister(e) {
  e.preventDefault();
  var btn      = document.getElementById('register-btn');
  var errEl    = document.getElementById('register-error');
  var username = document.getElementById('reg-username').value.trim();
  var email    = document.getElementById('reg-email').value.trim();
  var password = document.getElementById('reg-password').value;

  clearErrors();
  setLoading(btn, true);

  try {
    var res  = await fetch(API + '/api/register', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, email: email, password: password })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    currentUser = data.user;
    closeAuthModal();
    onUserLoggedIn();
    showToast('Welcome to PHNX, @' + currentUser.username + ' ✨', 'success');
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ─── Logout ─────────────────────────────────────────────────── */
async function handleLogout() {
  stopPolling();
  await fetch(API + '/api/logout', { method: 'POST', credentials: 'include' });
  currentUser  = null;
  currentPage  = 1;
  totalThreads = 0;
  latestId     = 0;
  onUserGuest();
  switchView('feed');
  loadFeed(true);
  startPolling();
  showToast('Logged out', 'success');
}

/* ─── Navigation ─────────────────────────────────────────────── */
function setupNavigation() {
  document.getElementById('nav-feed').addEventListener('click', function(e) {
    e.preventDefault();
    switchView('feed');
  });
  document.getElementById('nav-profile').addEventListener('click', function(e) {
    e.preventDefault();
    if (!currentUser) return openAuthModal('login');
    switchView('profile');
    loadProfileThreads();
  });
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.add('hidden'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('view-' + view).classList.remove('hidden');
  var navEl = document.getElementById('nav-' + view);
  if (navEl) navEl.classList.add('active');
}

/* ─── Feed (public — no auth needed) ────────────────────────── */
async function loadFeed(reset) {
  if (isLoading) return;
  if (reset) {
    currentPage  = 1;
    totalThreads = 0;
    latestId     = 0;
    document.getElementById('threads-feed').innerHTML = '';
    document.getElementById('feed-loading').classList.remove('hidden');
    document.getElementById('load-more-wrap').classList.add('hidden');
  }

  isLoading = true;
  try {
    var res  = await fetch(API + '/api/threads?page=' + currentPage + '&limit=' + LIMIT, {
      credentials: 'include'
    });
    var data = await res.json();
    totalThreads = data.total;
    document.getElementById('feed-loading').classList.add('hidden');

    var feed = document.getElementById('threads-feed');

    if (data.threads.length === 0 && currentPage === 1) {
      feed.innerHTML = '<div class="empty-state"><span class="empty-icon">✨</span><p>No threads yet. Be the first to post!</p></div>';
    } else {
      data.threads.forEach(function(t) {
        feed.appendChild(buildThreadCard(t));
        if (t.id > latestId) latestId = t.id;
      });
    }

    var loaded = (currentPage - 1) * LIMIT + data.threads.length;
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

async function loadMore() { await loadFeed(false); }

/* ─── Post Thread (requires auth) ───────────────────────────── */
async function postThread() {
  if (!currentUser) return openAuthModal('login');

  var input   = document.getElementById('compose-input');
  var content = input.value.trim();

  if (!content) return showToast('Write something first!', 'error');
  if (content.length > 500) return showToast('Too long! Max 500 characters.', 'error');

  var btn = document.getElementById('post-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="btn-spinner"></div>';

  try {
    var res  = await fetch(API + '/api/threads', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Post failed');

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('char-count').textContent = '500';
    document.getElementById('char-count').className = 'char-count';

    var feed  = document.getElementById('threads-feed');
    var empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();
    feed.insertBefore(buildThreadCard(data), feed.firstChild);
    totalThreads++;
    if (data.id > latestId) latestId = data.id;

    showToast('Thread posted! 🚀', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Post</span>';
  }
}

/* ─── Like (requires auth) ───────────────────────────────────── */
async function toggleLike(threadId, btn) {
  if (!currentUser) return openAuthModal('login');

  var countEl = btn.querySelector('.like-count');
  var isLiked = btn.classList.contains('liked');

  btn.classList.toggle('liked');
  countEl.textContent = parseInt(countEl.textContent) + (isLiked ? -1 : 1);

  try {
    var res  = await fetch(API + '/api/threads/' + threadId + '/like', {
      method: 'POST', credentials: 'include'
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error);
    countEl.textContent = data.like_count;
    if (data.liked) btn.classList.add('liked'); else btn.classList.remove('liked');
  } catch (e) {
    btn.classList.toggle('liked');
    countEl.textContent = parseInt(countEl.textContent) + (isLiked ? 1 : -1);
    showToast('Could not toggle like', 'error');
  }
}

/* ─── Delete Thread ──────────────────────────────────────────── */
async function deleteThread(threadId, cardEl) {
  if (!confirm('Delete this thread?')) return;
  try {
    var res = await fetch(API + '/api/threads/' + threadId, {
      method: 'DELETE', credentials: 'include'
    });
    if (!res.ok) throw new Error('Delete failed');
    cardEl.style.transition = 'all 0.3s ease';
    cardEl.style.opacity    = '0';
    cardEl.style.transform  = 'translateX(-20px)';
    setTimeout(function() { cardEl.remove(); }, 300);
    showToast('Thread deleted', 'success');
    totalThreads--;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Profile Threads ────────────────────────────────────────── */
async function loadProfileThreads() {
  var container = document.getElementById('profile-threads');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';
  try {
    var res  = await fetch(API + '/api/threads?limit=100', { credentials: 'include' });
    var data = await res.json();
    var mine = data.threads.filter(function(t) { return t.user_id === currentUser.id; });
    document.getElementById('stat-threads').textContent = mine.length;
    container.innerHTML = '';
    if (mine.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">📝</span><p>No threads yet. Share something!</p></div>';
    } else {
      mine.forEach(function(t) { container.appendChild(buildThreadCard(t)); });
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load threads.</p></div>';
  }
}

/* ─── Build Thread Card ──────────────────────────────────────── */
function buildThreadCard(thread) {
  var isOwn = currentUser && thread.user_id === currentUser.id;
  var card  = document.createElement('div');
  card.className = 'thread-card';
  card.id        = 'thread-' + thread.id;

  var likedFill  = thread.liked ? 'currentColor' : 'none';
  var likedClass = thread.liked ? 'liked' : '';

  var deleteBtnHtml = '';
  if (isOwn) {
    deleteBtnHtml =
      '<button class="action-btn delete-btn" onclick="deleteThread(' + thread.id + ', document.getElementById(\'thread-' + thread.id + '\'))" title="Delete thread">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>' +
        '</svg>' +
      '</button>';
  }

  card.innerHTML =
    '<div class="thread-avatar-wrap">' +
      '<img class="thread-avatar" src="' + thread.avatar + '" alt="' + escHtml(thread.username) + '" loading="lazy"/>' +
    '</div>' +
    '<div class="thread-body">' +
      '<div class="thread-header">' +
        '<span class="thread-username">@' + escHtml(thread.username) + '</span>' +
        '<button class="btn-info-score" id="score-btn-' + thread.id + '" onclick="fetchScore(' + thread.id + ', this)">information score</button>' +
        '<span class="thread-time">' + formatTime(thread.created_at) + '</span>' +
      '</div>' +
      '<p class="thread-content">' + escHtml(thread.content) + '</p>' +
      '<div id="score-popup-' + thread.id + '" class="score-popup hidden"></div>' +
      '<div class="thread-actions">' +
        '<button class="action-btn like-btn ' + likedClass + '" id="like-btn-' + thread.id + '" onclick="toggleLike(' + thread.id + ', this)">' +
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + likedFill + '" stroke="currentColor" stroke-width="2">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>' +
          '</svg>' +
          '<span class="like-count">' + thread.like_count + '</span>' +
        '</button>' +
        deleteBtnHtml +
      '</div>' +
    '</div>';

  return card;
}

/* ─── Information Score ──────────────────────────────────────── */
async function fetchScore(threadId, btn) {
  var card    = document.getElementById('thread-' + threadId);
  var content = card.querySelector('.thread-content').textContent;
  var popup   = document.getElementById('score-popup-' + threadId);

  // Toggle off if already open
  if (!popup.classList.contains('hidden')) {
    popup.classList.add('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'checking...';

  try {
    var res  = await fetch(API + '/api/score', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    var data = await res.json();

    if (!res.ok || data.error) {
      popup.innerHTML = '<div class="score-error">' + escHtml(data.error || 'Failed to get score') + '</div>';
    } else if (data.score === null || data.score === undefined) {
      popup.innerHTML = '<div class="score-error">Could not determine a score — the model response was in an unexpected format.</div>';
    } else {
      var score  = Math.min(100, Math.max(0, parseInt(data.score, 10)));
      var reason = data.reason || 'No reason provided.';
      var color  = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#f43f5e';
      var label  = score >= 70 ? 'Credible' : score >= 40 ? 'Uncertain' : 'Low credibility';

      popup.innerHTML =
        '<div class="score-header">' +
          '<span class="score-label">' + escHtml(label) + '</span>' +
          '<span class="score-number" style="color:' + color + '">' + score + ' / 100</span>' +
        '</div>' +
        '<div class="score-bar-wrap">' +
          '<div class="score-bar-track">' +
            '<div class="score-bar-fill" style="width:' + score + '%;background:' + color + '"></div>' +
          '</div>' +
        '</div>' +
        '<p class="score-reason">' + escHtml(reason) + '</p>';
    }
    popup.classList.remove('hidden');
  } catch (err) {
    popup.innerHTML = '<div class="score-error">' + escHtml(err.message) + '</div>';
    popup.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'information score';
  }
}

/* ─── Live Polling ───────────────────────────────────────────── */
function startPolling() {
  stopPolling();
  pollInterval = setInterval(pollNewThreads, POLL_MS);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function pollNewThreads() {
  var feedView = document.getElementById('view-feed');
  if (!feedView || feedView.classList.contains('hidden')) return;

  try {
    var res  = await fetch(API + '/api/threads?since_id=' + latestId, { credentials: 'include' });
    if (!res.ok) return;
    var data = await res.json();
    if (!data.threads || data.threads.length === 0) return;

    var feed  = document.getElementById('threads-feed');
    var empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();

    // API returns ASC (oldest first). insertBefore each: newest inserted last => lands on top.
    data.threads.forEach(function(t) {
      if (document.getElementById('thread-' + t.id)) return;
      var card = buildThreadCard(t);
      card.classList.add('thread-new');
      feed.insertBefore(card, feed.firstChild);
      setTimeout(function() { card.classList.remove('thread-new'); }, 1800);
      if (t.id > latestId) latestId = t.id;
    });

    totalThreads += data.threads.length;
  } catch (e) { /* ignore */ }
}

/* ─── Helpers ────────────────────────────────────────────────── */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function updateCharCount(el) {
  var remaining = 500 - el.value.length;
  var el2 = document.getElementById('char-count');
  el2.textContent = remaining;
  el2.className = 'char-count' + (remaining < 50 ? (remaining < 20 ? ' danger' : ' warning') : '');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  var d    = new Date(isoStr.replace(' ', 'T') + 'Z');
  var now  = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800)return Math.floor(diff/86400) + 'd ago';
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
  var span    = btn.querySelector('span');
  var spinner = btn.querySelector('.btn-spinner');
  if (span)    span.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(function(el) {
    el.classList.add('hidden');
    el.textContent = '';
  });
}

var toastTimer;
function showToast(msg, type) {
  type = type || '';
  var toast = document.getElementById('toast');
  var msgEl = document.getElementById('toast-message');
  toast.className = 'toast ' + type;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.classList.add('hidden'); }, 3200);
}
