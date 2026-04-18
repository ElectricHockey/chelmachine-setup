const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const seasons = require('../local/seasons');
const util = require('../local/util');
const config = global.config;
const users = require('../local/users');

router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.embed_description = 'Trophy Case';
  render_locals.seasons = await seasons.get_seasons(client);
  render_locals.season_id = req.query.season_id ? util.coerce_int(req.query.season_id) : render_locals.seasons[0].season_id;
  render_locals.trophies = await client.db(config.db).collection('trophy_descs').find({}).sort({order:-1}).toArray();
  render_locals.winners = await client.db(config.db).collection('trophy_winners').find({season_id:render_locals.season_id}).toArray();
  const usernames = render_locals.winners.map((x)=>x.type=='player'?x.winner:undefined).filter((x)=>x!=undefined);
  render_locals.users = usernames.length ? 
    await client.db(config.db).collection('users').find(util.mongo_or_array('auth.username',usernames)).toArray() : [];
  await users.add_members_to_users(client, render_locals.users);
  render_locals.teams = await client.db(config.db).collection('teams').find({season_id:render_locals.season_id}).toArray();
  render_locals.winners.forEach((w) => {
    w.user = render_locals.users.find((u)=>u.auth.username==w.winner);
    w.team = render_locals.teams.find((t)=>t._id.equals(w.winner));
  });
  res.render('trophy_case', render_locals);
  await client.close();
});

module.exports = router;
