const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');

router.get('/privacy', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.privacy = true;
  render_locals.embed_description = 'Privacy Policy';
  res.render('terms', render_locals);
  await client.close();
});

router.get('/service', async function(req, res) {
    const client = await db.client();
    const render_locals = await view_config.get(client, req);
    render_locals.service = true;
    render_locals.embed_description = 'Terms of Service';
    res.render('terms', render_locals);
    await client.close();
  });

module.exports = router;
