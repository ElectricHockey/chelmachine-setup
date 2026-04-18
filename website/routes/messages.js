const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const messages = require('../local/messages');

router.post('/', async function(req, res) {
    if (!req.user) {
        res.redirect(`/?status=${encodeURIComponent('Not logged in')}`);
        return;
    }
    const client = await db.client();
    if (req.body.read === '1') {
        await messages.mark_messages_read(client, req.user.id);
    } else if (req.body.delete === '1') {
        await messages.delete_messages(client, req.user.id);
    }
    await client.close();
    res.redirect('/messages');
});

router.get('/', async function(req, res) {
    if (!req.user) {
        res.redirect(`/?status=${encodeURIComponent('Not logged in')}`);
        return;
    }
    const client = await db.client();
    const render_locals = await view_config.get(client, req);
    render_locals.messages = await messages.get_messages(client, req.user.id);
    res.render('messages', render_locals);
    await client.close();
});

module.exports = router;
