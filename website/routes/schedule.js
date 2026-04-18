const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const seasons = require('../local/seasons');
const games = require('../local/games');
const util = require('../local/util');
const config = global.config;
const ObjectId = require('mongodb').ObjectId;

router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.views = ['week','season'];
  render_locals.view = req.query.view ? req.query.view : 'week';
  render_locals.seasons = await seasons.get_seasons(client);
  if (render_locals.seasons.length > 0) {
    render_locals.season_id = req.query.season_id ? util.coerce_int(req.query.season_id) : render_locals.seasons[0].season_id;
    render_locals.week_start = req.query.week_start ? util.date_from_seconds(req.query.week_start) : 
      util.date_add_days(util.get_last_sunday((new Date().toLocaleDateString())), config.schedule_start_day);
    render_locals.week_end = util.date_add_days(render_locals.week_start, 7);
    render_locals.previous_week = util.date_add_days(render_locals.week_start, -7);
    render_locals.next_week = render_locals.week_end;
    const filter = render_locals.view == 'week' ? 
      {date:{$gte:render_locals.week_start,$lt:render_locals.week_end}} : 
      {season_id:render_locals.season_id}

    if (req.query._id) {
      try {
        render_locals.team_schedule = true;
        render_locals.team = await client.db(config.db).collection('teams').findOne({_id:new ObjectId(req.query._id)});
        if (render_locals.team) {
          filter['$or'] = [
            {away_team_id:render_locals.team._id},
            {home_team_id:render_locals.team._id}];
        }
      } catch(e) {
        res.redirect(`/?status=${encodeURIComponent('Invalid Team ID')}`);
        await client.close();
        return;
      }
    }

    render_locals.games = await games.get_games_with_filter(client, filter);

    await games.add_streaming_options(client, render_locals.games);
    res.render('schedule', render_locals);
  } else {
    res.redirect(`/?status=${encodeURIComponent('No Seasons Found')}`);
  }
  await client.close();
});

module.exports = router;
