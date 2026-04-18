const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const teams = require('../local/teams');
const db = require('../local/db');
const games = require('../local/games');
const users = require('../local/users');
const stats = require('../local/stats');

router.get('/', async function(req, res) {
  if (req.query._id === undefined) {
    res.redirect(`/?status=${encodeURIComponent('No Team ID')}`);
    return;
  }
  
  const client = await db.client();
  const team = await teams.team_lookup(client, req.query._id);
  if (team === null) {
    res.redirect(`/?status=${encodeURIComponent('Invalid Team ID')}`);
    await client.close();
    return;
  }

  if (team.roster) {
    team.users = await users.get_usernames(client, team.roster);
  } else {
    team.users = [];
  }

  const render_locals = await view_config.get(client, req);
  const current_season = team.season_id;
  const game_type = req.query.game_type ? req.query.game_type : 'regular';
  const team_games = await games.get_team_completed_games_for_season(client, current_season, team._id, game_type);

  const current_teams_set = {};
  team_games.forEach((game) => {
    current_teams_set[game.home_team._id] = game.home_team;
    current_teams_set[game.away_team._id] = game.away_team;
    if (game.game_stats) {
      game.game_stats.game = game;
    }
  });
  const current_teams = Object.values(current_teams_set);
  team_games.forEach((g) => games.accumulate_team_standings(g, current_teams));
  render_locals.team = team;
  render_locals.embed_description = `Team page for ${team.team_name}`;
  const matches = team_games.map((g)=>g.game_stats).filter((g)=>g);
  const accum_filter = (g) => {
      return (club_id, player, match) => { // eslint-disable-line no-unused-vars
        const game = match.game;
        let expected_id;
        if (team._id.equals(game.away_team._id)) {
          expected_id = game.away_club_id;
        } else if (team._id.equals(game.home_team._id)) {
          expected_id = game.home_club_id;
        }

        if (expected_id == club_id) {
          if (g && player.position == 'goalie') {
            return true;
          } else if (!g && player.position != 'goalie') {
            return true;
          }
        }
    };
  };
  const all_skater_stats = stats.accumulate_matches(matches, accum_filter(false));
  const all_goalie_stats = stats.accumulate_matches(matches, accum_filter(true));
  await stats.add_discord_users_to_stats(client, all_skater_stats);
  await stats.add_discord_users_to_stats(client, all_goalie_stats);
  render_locals.skater_stats = all_skater_stats;
  render_locals.goalie_stats = all_goalie_stats;
  res.render('team', render_locals);
  await client.close();
});

module.exports = router;
