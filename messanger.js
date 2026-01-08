const express = require('express');

const posts = global.messengerPosts;

module.exports = function(app) {
  app.use(express.json());

  // Получить все посты (от новых к старым)
  app.get('/api/posts', (req, res) => {
    const sorted = posts.slice().sort((a, b) => b.timestamp - a.timestamp);
    res.json(sorted);
  });

  // Создать пост
  app.post('/api/posts', (req, res) => {
    const { link, description } = req.body;
    if (!link || !description) return res.status(400).json({ error: 'Нужно ссылку и описание' });

    let cleanLink = link.trim();
    if (!/^https?:\/\//i.test(cleanLink)) cleanLink = 'https://' + cleanLink;

    posts.push({
      link: cleanLink,
      description: description.trim(),
      timestamp: Date.now(),
      likes: 0,
      comments: []
    });

    res.status(201).json({ success: true });
  });

  // Лайк
  app.post('/api/react', (req, res) => {
    const { timestamp } = req.body;
    if (!timestamp) return res.status(400).json({ error: 'Нет timestamp' });

    const post = posts.find(p => p.timestamp === Number(timestamp));
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    post.likes += 1;
    res.json({ likes: post.likes });
  });

  // Комментарий
  app.post('/api/comments', (req, res) => {
    const { timestamp, text } = req.body;
    if (!timestamp || !text) return res.status(400).json({ error: 'Нужно timestamp и текст' });

    const post = posts.find(p => p.timestamp === Number(timestamp));
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    post.comments.push({
      text: text.trim(),
      timestamp: Date.now()
    });

    res.json({ success: true });
  });

  // Удалить пост
  app.delete('/api/posts', (req, res) => {
    const { timestamp } = req.body;
    if (!timestamp) return res.status(400).json({ error: 'Нет timestamp' });

    const index = posts.findIndex(p => p.timestamp === Number(timestamp));
    if (index !== -1) {
      posts.splice(index, 1);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Пост не найден' });
    }
  });
};
