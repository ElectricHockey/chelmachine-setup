const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const ObjectId = require('mongodb').ObjectId;
const fa = require('../local/fa');
const users = require('../local/users');
const util = require('../local/util');
const config = global.config;

/* GET home page. */
router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.embed_description = 'Review Offer Sheet';
  if (render_locals.pending_free_agent_offers) {
    const user = await users.get_record(client, req.user.id);
    if (user.application) {
      const team_ids = render_locals.pending_free_agent_offers.map((o)=>o.team);
      render_locals.current_teams = await client.db(config.db).collection('teams').find(util.mongo_or_array('_id',team_ids)).toArray();
      res.render('offer', render_locals);
    } else {
      res.redirect('/profile');
    }
  } else {
    res.redirect('/?status=No+Offers');
  }
  await client.close();
});

router.post('/', async function(req, res) {
  const client = await db.client();
  const _id = new ObjectId(req.body.offer_id);
  let status_message = "No Offer Accepted";
  if (req.user && (await fa.accept_offer(client, _id, req.user.id))) {
    status_message = "Offer Accepted!";
  }
  await client.close();
  res.redirect(`/?status=${encodeURIComponent(status_message)}`);
});

module.exports = router;
