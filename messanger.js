const path = require('path');
const express = require('express');

const posts = global.messengerPosts;
const bannedIPs = global.bannedIPs;
const mutedIPs = global.mutedIPs;

const ADMIN_TOKEN = 'grok-xai-spy-messenger-admin-2026'; // секретний токен

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || 'unknown';
}

module.exports = function(app) {
  app.use(express.json());

  // Адмін логін
  app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email.toLowerCase() === 'ivann.yaroshenko@gmail.com' && password === 'AI-0061+mm') {
      res.json({ token: ADMIN_TOKEN });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  // Адмін видалення поста
  app.post('/api/admin/delete-post', (req, res) => {
    const { token, timestamp } = req.body;
    if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Access denied' });
    const index = posts.findIndex(p => p.timestamp === Number(timestamp));
    if (index !== -1) {
      posts.splice(index, 1);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // Адмін модерація (бан/мут)
  app.post('/api/admin/moderate', (req, res) => {
    const { token, ip, action } = req.body;
    if (token !== ADMIN_TOKEN || !ip) return res.status(403).json({ error: 'Access denied' });
    if (action === 'ban_forever') {
      bannedIPs.add(ip);
    } else if (action.startsWith('mute_')) {
      let ms = Infinity;
      if (action === 'mute_1h') ms = 3600000;
      if (action === 'mute_24h') ms = 86400000;
      mutedIPs.set(ip, Date.now() + ms);
    }
    res.json({ success: true });
  });

  // Отримати пости (з authorIp тільки для адміна)
  app.get('/api/posts', (req, res) => {
    const token = req.headers['x-admin-token'];
    const isAdmin = token === ADMIN_TOKEN;

    const sorted = posts.slice().sort((a, b) => {
      const scoreA = (a.likes || 0) + (a.comments?.length || 0) * 2;
      const scoreB = (b.likes || 0) + (b.comments?.length || 0) * 2;
      return scoreB - scoreA; // від популярних до менш
    });

    const safePosts = sorted.map(p => {
      const copy = { ...p };
      if (!isAdmin) delete copy.authorIp;
      return copy;
    });

    res.json(safePosts);
  });

  // Створити пост
  app.post('/api/posts', (req, res) => {
    const ip = getIp(req);
    if (bannedIPs.has(ip)) return res.status(403).json({ error: 'Banned' });
    if (mutedIPs.has(ip) && Date.now() < mutedIPs.get(ip)) return res.status(403).json({ error: 'Muted' });

    const { link, description } = req.body;
    if (!link || !description) return res.status(400).json({ error: 'Need link and description' });

    let cleanLink = link.trim();
    if (!/^https?:\/\//i.test(cleanLink)) cleanLink = 'https://' + cleanLink;

    posts.push({
      link: cleanLink,
      description: description.trim(),
      timestamp: Date.now(),
      likes: 0,
      likedIPs: [],
      comments: [],
      authorIp: ip
    });

    res.status(201).json({ success: true });
  });

  // Лайк (один на IP)
  app.post('/api/react', (req, res) => {
    const ip = getIp(req);
    if (bannedIPs.has(ip)) return res.status(403).json({ error: 'Banned' });

    const { timestamp } = req.body;
    const post = posts.find(p => p.timestamp === Number(timestamp));
    if (!post) return res.status(404).json({ error: 'Not found' });

    if (post.likedIPs.includes(ip)) {
      return res.json({ likes: post.likes });
    }

    post.likedIPs.push(ip);
    post.likes++;
    res.json({ likes: post.likes });
  });

  // Коментар
  app.post('/api/comments', (req, res) => {
    const ip = getIp(req);
    if (bannedIPs.has(ip)) return res.status(403).json({ error: 'Banned' });
    if (mutedIPs.has(ip) && Date.now() < mutedIPs.get(ip)) return res.status(403).json({ error: 'Muted' });

    const { timestamp, text } = req.body;
    if (!timestamp || !text) return res.status(400).json({ error: 'Need timestamp and text' });

    const post = posts.find(p => p.timestamp === Number(timestamp));
    if (!post) return res.status(404).json({ error: 'Not found' });

    post.comments.push({
      text: text.trim(),
      timestamp: Date.now()
    });

    res.json({ success: true });
  });
};
