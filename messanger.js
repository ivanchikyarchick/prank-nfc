const express = require('express');

// Глобальний масив постів (з server.js)
const posts = global.messengerPosts;

module.exports = function(app) {
  app.use(express.json());

  // API: отримати всі пости (від нових до старих)
  app.get('/api/posts', (req, res) => {
    res.json(posts.slice().sort((a, b) => b.timestamp - a.timestamp));
  });

  // API: додати пост
  app.post('/api/posts', (req, res) => {
    const { link, description } = req.body;

    if (!link || !description) {
      return res.status(400).json({ error: 'Нужно и ссылку, и описание' });
    }

    let cleanLink = link.trim();
    if (!/^https?:\/\//i.test(cleanLink)) {
      cleanLink = 'https://' + cleanLink;
    }

    posts.push({
      link: cleanLink,
      description: description.trim(),
      timestamp: Date.now()
    });

    res.status(201).json({ success: true });
  });
};
