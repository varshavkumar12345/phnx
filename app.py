from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
import sqlite3
import hashlib
import os
import secrets
from datetime import datetime

app = Flask(__name__, static_folder='frontend', static_url_path='')
app.secret_key = secrets.token_hex(32)
CORS(app, supports_credentials=True)

DB_PATH = 'phnx.db'

# ─── Database Setup ────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                username  TEXT UNIQUE NOT NULL,
                email     TEXT UNIQUE NOT NULL,
                password  TEXT NOT NULL,
                avatar    TEXT DEFAULT '',
                bio       TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS threads (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                content    TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS likes (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL,
                thread_id INTEGER NOT NULL,
                UNIQUE(user_id, thread_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (thread_id) REFERENCES threads(id)
            );
        ''')
        conn.commit()

# ─── Helpers ───────────────────────────────────────────────────────────────────

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def current_user():
    return session.get('user_id')

def get_avatar_url(username):
    # Uses DiceBear API for generated avatars
    return f"https://api.dicebear.com/7.x/lorelei/svg?seed={username}"

# ─── Auth Routes ──────────────────────────────────────────────────────────────

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'error': 'All fields are required'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    try:
        with get_db() as conn:
            conn.execute(
                'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
                (username, email, hash_password(password))
            )
            conn.commit()
            user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
            session['user_id'] = user['id']
            return jsonify({
                'message': 'Account created!',
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'email': user['email'],
                    'avatar': get_avatar_url(user['username'])
                }
            }), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username or email already exists'}), 409

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'All fields are required'}), 400

    with get_db() as conn:
        user = conn.execute(
            'SELECT * FROM users WHERE username = ? AND password = ?',
            (username, hash_password(password))
        ).fetchone()

    if not user:
        return jsonify({'error': 'Invalid username or password'}), 401

    session['user_id'] = user['id']
    return jsonify({
        'message': 'Logged in!',
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user['email'],
            'avatar': get_avatar_url(user['username'])
        }
    })

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out'})

@app.route('/api/me', methods=['GET'])
def me():
    user_id = current_user()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'id': user['id'],
        'username': user['username'],
        'email': user['email'],
        'avatar': get_avatar_url(user['username'])
    })

# ─── Thread Routes ─────────────────────────────────────────────────────────────

@app.route('/api/threads', methods=['GET'])
def get_threads():
    user_id = current_user()
    page  = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 20))
    offset = (page - 1) * limit

    with get_db() as conn:
        threads = conn.execute('''
            SELECT t.id, t.content, t.created_at,
                   u.username, u.id as user_id,
                   COUNT(DISTINCT l.id) as like_count
            FROM threads t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN likes l ON t.id = l.thread_id
            GROUP BY t.id
            ORDER BY t.created_at DESC
            LIMIT ? OFFSET ?
        ''', (limit, offset)).fetchall()

        liked_ids = set()
        if user_id:
            rows = conn.execute('SELECT thread_id FROM likes WHERE user_id = ?', (user_id,)).fetchall()
            liked_ids = {r['thread_id'] for r in rows}

        total = conn.execute('SELECT COUNT(*) as c FROM threads').fetchone()['c']

    result = []
    for t in threads:
        result.append({
            'id': t['id'],
            'content': t['content'],
            'created_at': t['created_at'],
            'username': t['username'],
            'user_id': t['user_id'],
            'avatar': get_avatar_url(t['username']),
            'like_count': t['like_count'],
            'liked': t['id'] in liked_ids
        })

    return jsonify({'threads': result, 'total': total, 'page': page})

@app.route('/api/threads', methods=['POST'])
def create_thread():
    user_id = current_user()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401

    data    = request.get_json()
    content = data.get('content', '').strip()

    if not content:
        return jsonify({'error': 'Content cannot be empty'}), 400
    if len(content) > 500:
        return jsonify({'error': 'Thread too long (max 500 chars)'}), 400

    with get_db() as conn:
        cursor = conn.execute(
            'INSERT INTO threads (user_id, content) VALUES (?, ?)',
            (user_id, content)
        )
        conn.commit()
        thread_id = cursor.lastrowid
        thread = conn.execute('''
            SELECT t.id, t.content, t.created_at, u.username, u.id as user_id
            FROM threads t JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
        ''', (thread_id,)).fetchone()

    return jsonify({
        'id': thread['id'],
        'content': thread['content'],
        'created_at': thread['created_at'],
        'username': thread['username'],
        'user_id': thread['user_id'],
        'avatar': get_avatar_url(thread['username']),
        'like_count': 0,
        'liked': False
    }), 201

@app.route('/api/threads/<int:thread_id>', methods=['DELETE'])
def delete_thread(thread_id):
    user_id = current_user()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401

    with get_db() as conn:
        thread = conn.execute('SELECT * FROM threads WHERE id = ?', (thread_id,)).fetchone()
        if not thread:
            return jsonify({'error': 'Thread not found'}), 404
        if thread['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        conn.execute('DELETE FROM likes WHERE thread_id = ?', (thread_id,))
        conn.execute('DELETE FROM threads WHERE id = ?', (thread_id,))
        conn.commit()

    return jsonify({'message': 'Deleted'})

@app.route('/api/threads/<int:thread_id>/like', methods=['POST'])
def toggle_like(thread_id):
    user_id = current_user()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401

    with get_db() as conn:
        existing = conn.execute(
            'SELECT * FROM likes WHERE user_id = ? AND thread_id = ?',
            (user_id, thread_id)
        ).fetchone()

        if existing:
            conn.execute('DELETE FROM likes WHERE user_id = ? AND thread_id = ?', (user_id, thread_id))
            liked = False
        else:
            conn.execute('INSERT INTO likes (user_id, thread_id) VALUES (?, ?)', (user_id, thread_id))
            liked = True
        conn.commit()

        like_count = conn.execute(
            'SELECT COUNT(*) as c FROM likes WHERE thread_id = ?', (thread_id,)
        ).fetchone()['c']

    return jsonify({'liked': liked, 'like_count': like_count})

# ─── Serve Frontend ────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('frontend', 'index.html')

# ─── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    print("✨ PHNX running on http://127.0.0.1:5000")
    app.run(debug=True, port=5000)