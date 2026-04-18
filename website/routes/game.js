const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const games = require('../local/games');
const db = require('../local/db');
const stats = require('../local/stats');

router.get('/', async function(req, res) {
  if (req.query._id === undefined) {
    res.redirect('/?status=No+Game+ID');
    return;
  }

  const client = await db.client();

  // get game
  const game = await games.get_single_game(client, req.query._id);
  if (!game || !game.game_stats) {
    res.redirect('/?status=Game+Not+Found');
    await client.close();
    return;
  }

  const render_locals = await view_config.get(client, req);
  render_locals.game = game;
  
  // some shorthand helpers for pug
  render_locals.away_stats = game.game_stats.clubs[game.away_club_id];
  render_locals.home_stats = game.game_stats.clubs[game.home_club_id];
  render_locals.away_stats.toa = render_locals.seconds_to_walltime(render_locals.away_stats.toa);
  render_locals.home_stats.toa = render_locals.seconds_to_walltime(render_locals.home_stats.toa);

  render_locals.embed_description = 'Game Results';
  render_locals.pretty_rating = function(rating) {
    if (rating === '' || rating === null || rating === undefined) return '-';
    return `${Math.floor(parseInt(rating))}%`;
  }
  await stats.add_discord_users_to_stats(client, stats.filter_player_stats(game.game_stats));
  render_locals.home_skater_stats = stats.filter_player_stats(game.game_stats, (p)=>p.team_id==game.home_club_id&&p.position!='goalie');
  render_locals.away_skater_stats = stats.filter_player_stats(game.game_stats, (p)=>p.team_id==game.away_club_id&&p.position!='goalie');
  render_locals.home_goalie_stats = stats.filter_player_stats(game.game_stats, (p)=>p.team_id==game.home_club_id&&p.position=='goalie');
  render_locals.away_goalie_stats = stats.filter_player_stats(game.game_stats, (p)=>p.team_id==game.away_club_id&&p.position=='goalie');

  res.render('game', render_locals);
  await client.close();
});

module.exports = router;
