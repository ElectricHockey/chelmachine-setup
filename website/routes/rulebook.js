const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const markdown = require('../local/markdown');

router.get('/', async function(req, res) {
    const client = await db.client();
    const render_locals = await view_config.get(client, req);
    render_locals.rulebook = await markdown.latest_md(client, 'rulebook');
    if (render_locals.rulebook) {
        render_locals.rulebookmd = markdown.render(render_locals.rulebook.content);
    }
    render_locals.embed_description = 'Rulebook';
    res.render('rulebook', render_locals);
    await client.close();
});

module.exports = router;
