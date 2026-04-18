const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const teams = require('../local/teams');
const seasons = require('../local/seasons');
const games = require('../local/games');
const db = require('../local/db');
const util = require('../local/util');

const init_standings = (team) => {
  const init_record = () => { return {w:0,l:0,ot:0}; };
  return {team,gp:0,w:0,l:0,ot:0,points:0,rw:0,row:0,gf:0,ga:0,
    record_away:init_record(),record_home:init_record(),
    record_conf:init_record(),record_nonconf:init_record(),streak:0};
}

const record_shared = (stats, gf, ga) => {
  ++stats.gp;
  stats.gf += util.coerce_int(gf);
  stats.ga += util.coerce_int(ga);
}

const record_win = (stats, game, gf, ga, ot) => {
  record_shared(stats, gf, ga);
  ++stats.w;
  stats.points += 2;
  if (ot) {
    ++stats.row;
  } else {
    ++stats.rw;
  }
  if (game.home_team._id.equals(stats.team._id)) {
    ++stats.record_home.w;
  } else if (game.away_team._id.equals(stats.team._id)) {
    ++stats.record_away.w;
  }

  if (game.home_team.conference == game.away_team.conference) {
    ++stats.record_conf.w;
  } else {
    ++stats.record_nonconf.w;
  }

  if (stats.streak < 0) {
    stats.streak = 1;
  } else {
    ++stats.streak;
  }
}

const record_loss = (stats, game, gf, ga, ot) => {
  record_shared(stats, gf, ga);
  if (ot) {
    ++stats.ot;
    ++stats.points;
    if (game.home_team._id.equals(stats.team._id)) {
      ++stats.record_home.ot;
    } else if (game.away_team._id.equals(stats.team._id)) {
      ++stats.record_away.ot;
    }
    if (game.home_team.conference == game.away_team.conference) {
      ++stats.record_conf.ot;
    } else {
      ++stats.record_nonconf.ot;
    }
  } else {
    ++stats.l;
    if (game.home_team._id.equals(stats.team._id)) {
      ++stats.record_home.l;
    } else if (game.away_team._id.equals(stats.team._id)) {
      ++stats.record_away.l;
    }
    if (game.home_team.conference == game.away_team.conference) {
      ++stats.record_conf.l;
    } else {
      ++stats.record_nonconf.l;
    }
  }
  if (stats.streak > 0) {
    stats.streak = -1;
  } else {
    --stats.streak;
  }
}

const process_game = (game, stats) => {
  if (game.game_stats) {
    const clubs = Object.entries(game.game_stats.clubs);
    const away_club = clubs.find((c)=>c[0]==game.away_club_id)[1];
    const home_club = clubs.find((c)=>c[0]==game.home_club_id)[1];
    const winner_id = away_club.gfraw >= home_club.gfraw ? game.away_club_id : game.home_club_id;
    const winner_stats = stats.find((s)=>s.team._id.equals(game.winning_team._id));
    const loser_stats = stats.find((s)=>s.team._id.equals(game.losing_team._id));
    util.assert(winner_stats && loser_stats);
    const wca = clubs.find((c)=>c[0]==winner_id);
    const lca = clubs.find((c)=>c[0]!=winner_id);
    if (!wca || !lca)
      return;
    const winner_club = wca[1];
    const loser_club = lca[1];
    const ot = (winner_club.result == 5 || winner_club.result == 6);
    record_win(winner_stats, game, winner_club.gfraw, winner_club.garaw, ot);
    record_loss(loser_stats, game, loser_club.gfraw, loser_club.garaw, ot);
  } else if (game.forfeit_winner != undefined) {
    let winner_stats, loser_stats;
    if (game.forfeit_winner == game.away_club_id) {
      winner_stats = stats.find((s)=>s.team._id.equals(game.away_team._id));
      loser_stats = stats.find((s)=>s.team._id.equals(game.home_team._id));
    } else {
      winner_stats = stats.find((s)=>s.team._id.equals(game.home_team._id));
      loser_stats = stats.find((s)=>s.team._id.equals(game.away_team._id));
    }

    util.assert(winner_stats && loser_stats);
    record_win(winner_stats, game, 1, 0, false);
    record_loss(loser_stats, game, 0, 1, false);
  } else if (game.forfeit_draw == true) {
    const away_stats = stats.find((s)=>s.team._id.equals(game.away_team_id));
    const home_stats = stats.find((s)=>s.team._id.equals(game.home_team_id));

    if (away_stats) {
      ++away_stats.gp;
      away_stats.streak = 0;
    }

    if (home_stats) {
      ++home_stats.gp;
      home_stats.streak = 0;
    }
  }
}

const sort_stats = (a,b) => {
  const points_diff = b.points - a.points;
  if (points_diff == 0) {
    const gp_diff = b.gp - a.gp;
    if (gp_diff == 0) {
      const rw_diff = b.rw - a.rw;
      if (rw_diff == 0) {
        const row_diff = b.row - a.row;
        if (row_diff == 0) {
          const w_diff = b.w - a.rw;
          if (w_diff == 0) {
            const p_diff = (b.gf-b.ga) - (a.gf-a.ga);
            if (p_diff == 0) {
              const gf_diff = b.gf - a.gf;
              return gf_diff;
            }
            return p_diff;
          }
          return w_diff;
        }
        return row_diff;
      }
      return rw_diff;
    }
    return gp_diff;
  }
  return points_diff;
}

const filter_stats = (stats) => {
  return stats.filter((stat) => {
    return !(stat.team.visible === false);
  });
};

router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  render_locals.seasons = await seasons.get_seasons(client);
  if (render_locals.seasons.length > 0) {
    const current_season = req.query.season_id ? util.coerce_int(req.query.season_id) : render_locals.seasons[0].season_id;
    const current_teams = await teams.season_teams(client, current_season);
    render_locals.formats = ['league','division','conference'];
    render_locals.format = req.query.format ? req.query.format : render_locals.formats[1];
    render_locals.season_id = current_season;
    render_locals.game_types = games.game_types;
    render_locals.game_type = req.query.game_type ? req.query.game_type : 'regular';
    const all_games = await games.get_completed_games(client, current_season, render_locals.game_type);
    const stats = current_teams.map((team)=>{return init_standings(team)});
    all_games.forEach((game)=>process_game(game, stats));

    render_locals.stats = filter_stats(stats.sort(sort_stats));
    render_locals.embed_description = 'Standings';
    res.render('standings', render_locals);
  } else {
    res.redirect(`/?status=${encodeURIComponent('No Seasons Found')}`);
  }
  await client.close();
});

module.exports = router;
