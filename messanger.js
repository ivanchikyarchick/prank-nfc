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

app.delete('/api/posts', (req, res) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: 'Нет timestamp' });
  }

  const index = posts.findIndex(p => p.timestamp === timestamp);
  if (index !== -1) {
    posts.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Пост не найден' });
  }
});
