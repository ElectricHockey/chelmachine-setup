const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const seasons = require('../local/seasons');
const games = require('../local/games');
const util = require('../local/util');
const stats = require('../local/stats');
const config = global.config;

router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.seasons = await seasons.get_seasons(client);
  render_locals.game_type = req.query.game_type ? req.query.game_type : 'regular';
  const season_id = req.query.season_id ? util.coerce_int(req.query.season_id) : render_locals.seasons[0].season_id;
  render_locals.season_id = season_id;
  render_locals.game_types = games.game_types;

  if (req.query.full_stats) {
    render_locals.full_stats = true;
    const fixundefined = (x) => x == 'undefined' ? undefined : x;
    render_locals.start_date = fixundefined(req.query.start_date);
    render_locals.end_date = fixundefined(req.query.end_date);
    render_locals.position = req.query.position;
    let seasons_games;
    if (render_locals.start_date && render_locals.end_date) {
      seasons_games = await games.get_completed_games_in_date_range(client, season_id, render_locals.game_type, render_locals.start_date, render_locals.end_date);
    } else {
      seasons_games = await games.get_completed_games(client, season_id, render_locals.game_type);
      const dates = seasons_games.map((g)=>g.date).sort((a,b)=>a.getTime()-b.getTime());
      if (dates && dates.length > 0) {
        render_locals.start_date = util.date_add_days(dates[0],-1).toISOString().split('T',1)[0];
        render_locals.end_date = util.date_add_days(dates[dates.length-1],1).toISOString().split('T',1)[0];
      }
    }
    const tmap = {};
    const gmap = {};
    seasons_games.forEach((game) => {
      tmap[game.away_team._id] = game.away_team;
      tmap[game.home_team._id] = game.home_team;
      if (game.game_stats) {
        gmap[game.game_stats._id] = game;
      }
    });
    render_locals.teams = Object.values(tmap);
    render_locals.team = req.query.team ? req.query.team : '';
    const matches = seasons_games.map((g)=>g.game_stats).filter((g)=>g);
    const all_stats = stats.accumulate_matches(matches, (club_id,player,match) => {
      if (req.query.team) {
        const game = gmap[match._id];
        let cid;
        if (game.home_team_id.equals(req.query.team)) {
          cid = game.home_club_id;
        } else if (game.away_team_id.equals(req.query.team)) {
          cid = game.away_club_id;
        } else {
          return false;
        }
        if (cid != club_id) {
          return false;
        }
      }

      if (render_locals.position) {
        const filters = {
          'C': () => player.posSorted == '5',
          'LW': () => player.posSorted == '4',
          'RW': () => player.posSorted == '3',
          'LD': () => player.posSorted == '2',
          'RD': () => player.posSorted == '1',
          'FWD': () => ['5','4','3'].includes(player.posSorted),
          'DEF': () => player.position == 'defenseMen'
        };
        const f = filters[render_locals.position];
        if (f && !f()) {
          return false;
        }
      }

      if (req.query.full_stats === 'skater') {
        return player.position != 'goalie';
      } else if (req.query.full_stats === 'goalie') {
        return player.position == 'goalie';
      }
    });
    await stats.add_discord_users_to_stats(client, all_stats);
    stats.add_player_team_to_accumulated_stats(seasons_games, all_stats);
    render_locals.stats = all_stats;
  } else {
    const seasons_games = await games.get_completed_games(client, season_id, render_locals.game_type);
    const matches = seasons_games.map((g)=>g.game_stats).filter((g)=>g);
    const rows = 5;
    const game_type = render_locals.game_type;
    render_locals.full_stat_links = {
      'Skating Leaders': `/player_stats?full_stats=skater&game_type=${game_type}&season_id=${season_id}`,
      'Goaltending Leaders': `/player_stats?full_stats=goalie&game_type=${game_type}&season_id=${season_id}`
    };
    render_locals.full_stat_text = {
      'Skating Leaders': 'Full Skating Stats',
      'Goaltending Leaders': 'Full Goaltending Stats'
    };
    render_locals.min_games = config.site.player_stats_min_games;
    const gpf = (player) => player.games >= render_locals.min_games;
    const skater_stats = stats.accumulate_matches(matches, (club_id,player) => player.position!='goalie').filter(gpf);
    const goalie_stats = stats.accumulate_matches(matches, (club_id,player) => player.position=='goalie').filter(gpf);
    await stats.add_discord_users_to_stats(client, skater_stats);
    await stats.add_discord_users_to_stats(client, goalie_stats);

    skater_stats.forEach((p) => {
      const skg = util.coerce_int(p.skgoals);
      const ska = util.coerce_int(p.skassists);
      const sks = util.coerce_int(p.skshots);
      p.points = skg + ska;
      p.pointsgp = (p.points / p.games).toFixed(2);
      p.goalsgp = (skg / p.games).toFixed(2);
      p.assistsgp = (ska / p.games).toFixed(2);
      p.goalpct = (skg / sks).toFixed(2);
    });
    render_locals.stats = {
      'Skating Leaders': {
        'Points': { data: skater_stats.sort((a,b) => b.points - a.points).slice(0,rows), datakey: 'points' },
        'Goals': { data: skater_stats.sort((a,b) => b.skgoals - a.skgoals).slice(0,rows), datakey: 'skgoals' },
        'Plus/Minus': { data: skater_stats.sort((a,b) => b.skplusmin - a.skplusmin).slice(0,rows), datakey: 'skplusmin', plusminus: true },
        'Assists': { data: skater_stats.sort((a,b) => b.skassists - a.skassists).slice(0,rows), datakey: 'skassists' },
        'Hits': { data: skater_stats.sort((a,b) => b.skhits - a.skhits).slice(0,rows), datakey: 'skhits' },
        'Points / Games Played': { data: skater_stats.sort((a,b) => b.pointsgp - a.pointsgp).slice(0,rows), datakey: 'pointsgp' },
        'Goals / Games Played': { data: skater_stats.sort((a,b) => b.goalsgp - a.goalsgp).slice(0,rows), datakey: 'goalsgp' },
        'Assists / Games Played': { data: skater_stats.sort((a,b) => b.assistsgp - a.assistsgp).slice(0,rows), datakey: 'assistsgp' },
        'Goal%': { data: skater_stats.sort((a,b) => b.goalpct - a.goalpct).slice(0,rows), datakey: 'goalpct', percent: true },
        'Penalty Minutes': { data: skater_stats.sort((a,b) => b.skpim - a.skpim).slice(0,rows).filter((x)=>x.skpim>0), datakey: 'skpim' },
        'Shots': { data: skater_stats.sort((a,b) => b.skshots - a.skshots).slice(0,rows), datakey: 'skshots' },
        'Blocked Shots': { data: skater_stats.sort((a,b) => b.skbs - a.skbs).slice(0,rows), datakey: 'skbs' },
        'Giveaways (Least)': { data: skater_stats.sort((a,b) => a.skgiveaways - b.skgiveaways).slice(0,rows), datakey: 'skgiveaways' },
        'Takeaways': { data: skater_stats.sort((a,b) => b.sktakeaways - a.sktakeaways).slice(0,rows), datakey: 'sktakeaways' },
        'Interceptions': { data: skater_stats.sort((a,b) => b.skinterceptions - a.skinterceptions).slice(0,rows), datakey: 'skinterceptions' },
        'Faceoff Wins': { data: skater_stats.sort((a,b) => b.skfow - a.skfow).slice(0,rows), datakey: 'skfow' },
        'Faceoff Win%': { data: skater_stats.sort((a,b) => b.skfopct - a.skfopct).slice(0,rows), datakey: 'skfopct', percent: true },
        'Hat Tricks': { data: skater_stats.sort((a,b) => b.hattricks - a.hattricks).slice(0,rows), datakey: 'hattricks' }
      },
      'Goaltending Leaders': {
        'Goals Against AVG': { data: goalie_stats.sort((a,b) => a.glgaa - b.glgaa).slice(0,rows), datakey: 'glgaa', gaa: true },
        'Save%': { data: goalie_stats.sort((a,b) => b.glsavepct - a.glsavepct).slice(0,rows), datakey: 'glsavepct', percent: true },
        'Wins': { data: goalie_stats.sort((a,b) => b.wins - a.wins).slice(0,rows), datakey: 'wins' }, 
        'Saves': { data: goalie_stats.sort((a,b) => b.glsaves - a.glsaves).slice(0,rows), datakey: 'glsaves' },
        'Shutouts': { data: goalie_stats.sort((a,b) => b.glshutouts - a.glshutouts).slice(0,rows), datakey: 'glshutouts' },
        'Points': { data: goalie_stats.sort((a,b) => b.glpoints - a.glpoints).slice(0,rows).filter((x)=>x.glpoints>0), datakey: 'glpoints' }
      }
    }
  }
  
  render_locals.embed_description = 'Player Stats';
  res.render('player_stats', render_locals);
  await client.close();
});

module.exports = router;
