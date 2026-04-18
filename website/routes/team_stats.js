const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const seasons = require('../local/seasons');
const games = require('../local/games');
const util = require('../local/util');

router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  const game_type = req.query.game_type ? req.query.game_type : 'regular';
  render_locals.game_types = games.game_types;
  render_locals.game_type = game_type;
  render_locals.seasons = await seasons.get_seasons(client);
  render_locals.season_id = req.query.season_id ? util.coerce_int(req.query.season_id) : render_locals.seasons[0].season_id;
  const seasons_games = await games.get_completed_games(client, render_locals.season_id, game_type);
  const team_stats_arr = games.get_team_stats_for_games(seasons_games);

  if (req.query && req.query.full_stats) {
    render_locals.full_stats = true;
    render_locals.stats = team_stats_arr;
    render_locals.rank_stats = true;
  } else {
    const rows = 5;
    render_locals.full_stat_links = {
        'Skating Leaders': `/team_stats?game_type=${game_type}&full_stats=skater&season_id=${render_locals.season_id}`,
        'Goaltending Leaders': `/team_stats?game_type=${game_type}&full_stats=goalie&season_id=${render_locals.season_id}`
    };
    render_locals.full_stat_text = {
        'Skating Leaders': 'Full Skating Stats',
        'Goaltending Leaders': 'Full Goalie Stats'
    };

    render_locals.stats = {
        'Skating Leaders': {
            'Goals': { data: team_stats_arr.sort((a,b) => b.goals - a.goals).slice(0,rows), datakey: 'goals' },
            'Goal%': { data: team_stats_arr.sort((a,b) => b.goalpct - a.goalpct).slice(0,rows), datakey: 'goalpct', percent: true },
            'Points': { data: team_stats_arr.sort((a,b) => b.points - a.points).slice(0,rows), datakey: 'points' },
            'Assists': { data: team_stats_arr.sort((a,b) => b.assists - a.assists).slice(0,rows), datakey: 'assists' },
            'Plus/Minus': { data: team_stats_arr.sort((a,b) => b.plusmin - a.plusmin).slice(0,rows), datakey: 'plusmin', plusminus: true },
            'Hits': { data: team_stats_arr.sort((a,b) => b.hits - a.hits).slice(0,rows), datakey: 'hits' },
            'Penalty Minutes (Least)': { data: team_stats_arr.sort((a,b) => a.pim - b.pim).slice(0,rows).filter((x)=>x.pim>0), datakey: 'pim' },
            'Shots': { data: team_stats_arr.sort((a,b) => b.shots - a.shots).slice(0,rows), datakey: 'shots' },
            'Blocked Shots': { data: team_stats_arr.sort((a,b) => b.bs - a.bs).slice(0,rows), datakey: 'bs' },
            'Giveaways (Least)': { data: team_stats_arr.sort((a,b) => a.giveaways - b.giveaways).slice(0,rows), datakey: 'giveaways' },
            'Takeaways': { data: team_stats_arr.sort((a,b) => b.takeaways - a.takeaways).slice(0,rows), datakey: 'takeaways' },
            'Interceptions': { data: team_stats_arr.sort((a,b) => b.interceptions - a.interceptions).slice(0,rows), datakey: 'interceptions' },
            'Faceoff Wins': { data: team_stats_arr.sort((a,b) => b.fow - a.fow).slice(0,rows), datakey: 'fow' },
            'Faceoff Win%': { data: team_stats_arr.sort((a,b) => b.fopct - a.fopct).slice(0,rows), datakey: 'fopct', percent: true },
            'Hat Tricks': { data: team_stats_arr.sort((a,b) => b.ht - a.ht).slice(0,rows), datakey: 'ht' }
        },
        'Goaltending Leaders': {
        'Goals Against AVG': { data: team_stats_arr.sort((a,b) => a.glgaa - b.glgaa).slice(0,rows), datakey: 'glgaa', gaa: true },
        'Save%': { data: team_stats_arr.sort((a,b) => b.glsavep - a.glsavep).slice(0,rows), datakey: 'glsavep', percent: true },
        'Saves': { data: team_stats_arr.sort((a,b) => b.glsaves - a.glsaves).slice(0,rows), datakey: 'glsaves' },
        //'Shutouts': { data: team_stats_arr.sort((a,b) => b.glshutouts - a.glshutouts).slice(0,rows), datakey: 'glshutouts' },
        'Points': { data: team_stats_arr.sort((a,b) => b.glpoints - a.glpoints).slice(0,rows).filter((x)=>x.glpoints>0), datakey: 'glpoints' }
        }
    };
  }
  render_locals.embed_description = 'Team Stats';
  res.render('team_stats', render_locals);
  await client.close();
});

module.exports = router;
