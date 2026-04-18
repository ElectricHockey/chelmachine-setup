const { DateTime } = require('luxon');
const util = require('./util');
const cvar = require('./cvar');
const config = global.config;

let team_id_gen = 1;

let teams = [];
let schedules = [];
let matches = [];

const resolve_datetime = function(game) {
    const tm = game.time.match(/.*([0-9]+):([0-9]+)/);
    const hours = util.coerce_int(tm[1]);
    const minutes = util.coerce_int(tm[2]);
    const date = DateTime.fromFormat(game.date, "EEEE MMMM d, yyyy", { zone: 'America/New_York' });
    const fdate = date.plus(1000*60*minutes + 1000*60*60*hours);
    const jsdate = fdate.toJSDate();
    if (isNaN(jsdate)) {
      throw new Error("PROBLEM");
    }
    return jsdate;
}

const resolve_club_id = function(game, team_name) {
    for (let i = 0;i < teams.length;i++) {
        const t = teams[i];
        if (t.team_name == team_name && game.season_id == t.season_id) {
            return t.team_id.toString();
        }
    }
    const team_id = team_id_gen++;
    const season_id = game.season_id;
    const team = {
        team_id,
        team_name,
        season_id,
    };
    teams.push(team);
    return team.team_id.toString();
}

const resolve_home_club_id = (g) => resolve_club_id(g,g.home_team);
const resolve_away_club_id = (g) => resolve_club_id(g,g.away_team);

const process_box_score = function(game, box_score_soup) {
    const box_score = { away: {}, home: {} };
    box_score_soup.header.forEach((h) => {
        const hi = box_score_soup.header.indexOf(h);
        if (h === 'Team') {
            return;
        } else if (h == '1') {
            box_score.away['1p'] = box_score_soup.first[hi];
            box_score.home['1p'] = box_score_soup.second[hi];
        } else if (h == '2') {
            box_score.away['2p'] = box_score_soup.first[hi];
            box_score.home['2p'] = box_score_soup.second[hi];
        } else if (h === '3') {
            box_score.away['3p'] = box_score_soup.first[hi];
            box_score.home['3p'] = box_score_soup.second[hi];
        } else if (h === 'OT 1' || h === 'OT') {
            box_score.away['ot'] = util.coerce_int(box_score_soup.first[hi]);
            box_score.home['ot'] = util.coerce_int(box_score_soup.second[hi]);
        } else if (h.startsWith('OT')) {
            box_score.away['ot'] += util.coerce_int(box_score_soup.first[hi]);
            box_score.home['ot'] += util.coerce_int(box_score_soup.second[hi]);
        } else if (h === 'TOT') {
            box_score.away['tot'] = box_score_soup.first[hi];
            box_score.home['tot'] = box_score_soup.second[hi];
        } else {
            throw new Error("Derp");
        }
    });
    return box_score;
}

const process_playername = function(game, soup_name) {
  if (game.league_name === 'axhl') {
    return soup_name.match(/(.+),.+/)[1];
  } else if (game.league_name == 'lmshl') {
    return soup_name;
  } else {
    return soup_name.match(/\((.+)\)/)[1];
  }
}

const resolve_skater_position = function(manual_stat_position) {
  const pos_map = {
    'LW': 'leftWing',
    'LD': 'defenseMen',
    'RD': 'defenseMen',
    'RW': 'rightWing',
    'C': 'center',
  };
  if (manual_stat_position in pos_map) {
    return pos_map[manual_stat_position];
  } else {
    return 'skater';
  }
};

const resolve_skater_pos_sorted = function(manual_stat_position) {
  const pos_sorted_map = {
    'LD': '2',
    'RD': '1',
    'LW': '4',
    'RW': '3',
    'C': '5',
  };
  if (manual_stat_position in pos_sorted_map) {
    return pos_sorted_map[manual_stat_position];
  } else {
    return '-1';
  }
}

const process_skater_stats = function(game, side) {
  const skaters = {};
  Object.keys(game.stats.skaters[side]).forEach((soup_name) => {
    const playername = process_playername(game, soup_name);
    const fields = game.stats.skaters['_fields'];
    const stats = game.stats.skaters[side][soup_name];
    const skater = { playername };
    const map_field = function (iff,of) {
      skater[of] = stats[fields.indexOf(iff)];
    };
    let fo = 0;
    const skater_map = {
      'POS': 'manual_stat_position',
      'G': 'skgoals',
      'A': 'skassists',
      'HITS': 'skhits',
      'PIM': 'skpim',
      'S': 'skshots',
      'BS': 'skbs',
      '+/-': 'skplusmin',
      'GVA': 'skgiveaways',
      'TKA': 'sktakeaways',
      'INT': 'skinterceptions',
      'FOW': 'skfow',
      'FO%': 'skfopct',
      'PA': 'skpassattempts',
      'PC': 'skpasses',
    };
    fields.forEach((f) => {
      if (f in skater_map) {
        map_field(f,skater_map[f]);
      } else if (f === 'FO') {
        fo = util.coerce_int(stats[fields.indexOf(f)]);
      }
    });
    skater.position = resolve_skater_position(skater.manual_stat_position);
    skater.posSorted = resolve_skater_pos_sorted(skater.manual_stat_position);
    skater.skpasspct = util.coerce_float(skater.skpasses) / util.coerce_float(skater.skpassattempts);
    skater.skshotpct = util.coerce_float(skater.skgoals) / util.coerce_float(skater.skshots);
    skater.toi = 60 - util.coerce_int(skater.skpim);
    skater.toiseconds = skater.toi * 60;
    skater.skfol = fo - util.coerce_int(skater.skfow);
    skaters[playername] = skater;
  });
    return skaters;
}

const process_goalie_stats = function(game, side) {
  const goalies = {};
  Object.keys(game.stats.goalies[side]).forEach((soup_name) => {
    const playername = process_playername(game, soup_name);
    const fields = game.stats.goalies['_fields'];
    const stats = game.stats.goalies[side][soup_name];
    const goalie = { playername };
    const map_field = function (iff,of) {
      goalie[of] = stats[fields.indexOf(iff)];
    };
    const goalie_map = {
      'SA': 'glshots',
      'GA': 'glga',
      'PIM': 'skpim',
      'G': 'skgoals',
      'A': 'skassists',
      'TOI': 'toi',
      'SV': 'glsaves',
    };
    const fields_ignore = ['GOALIES','W','L','OTW','OTL','GAA','SV%','PTS','SO'];
    fields.forEach((f) => {
      if (f in goalie_map) {
        map_field(f,goalie_map[f]);
      } else if (!fields_ignore.includes(f)) {
        throw new Error("UNKNOWN FIELD");
      }
    });
    goalie.manual_stat_position = 'G';
    goalie.position = 'goalie';
    goalie.posSorted = '0';
    goalie.toiseconds = util.coerce_int(goalie.toi) * 60;
    goalie.glgaa = util.compute_gaa(goalie.glga, goalie.toiseconds);
    goalie.glsavepct = util.coerce_int(goalie.glsaves) / util.coerce_int(goalie.glshots);
    goalies[playername] = goalie;
  });
  return goalies;
}

const process_player_stats = function(game, side) {
  return {...process_skater_stats(game, side),...process_goalie_stats(game, side)};
}

const process_club_num = function(match, game, side, field) {
  const players = match.players[game[`${side}_club_id`]];
  const playernames = Object.keys(players);
  if (playernames.length > 0) {
    let fval = 0;
    playernames.forEach((playername) => {
      if (field in players[playername]) {
        fval += util.coerce_int(players[playername][field]);
        if (isNaN(fval)) {
          throw new Error("PROBLEM");
        }
      }
    });
    return fval;
  } else {
    if (game.stats && game.stats.box_score) {
      const box_score = game.stats.box_score;
      const totidx = box_score.header.indexOf('TOT');
      if (box_score.first[0].trim() === game[`${side}_team`]) {
        return util.coerce_int(box_score.first[totidx]);
      } else if (box_score.second[0].trim() === game[`${side}_team`]) {
        return util.coerce_int(box_score.second[totidx]);
      } else {
        throw new Error("PROBLEM");
      }
    } else {
      throw new Error("PROBLEM");
    }
  }
}

const process_club_pp = (game,side,i) => {
  const summary = game.stats.summary;
  if ('POWER PLAY' in summary) {
    const pp = summary['POWER PLAY'][side];
    if (pp === '-') {
      return '0';
    }
    const prx = pp.match(/(\d+) \/ (\d+)/);
    return prx[i];
  } else {
    return 0;
  }
};

const process_club_toa = (game,side) => {
  if (!('TIME ON ATTACK' in game.stats.summary)) {
    return 0;
  }
  const toa = game.stats.summary['TIME ON ATTACK'];
  const toar = toa[side];
  const tm = toar.match(/(\d+):(\d+)/);
  if (!tm) {
    return 0;
  }
  const min = util.coerce_int(tm[1]);
  const sec = util.coerce_int(tm[2]);
  return sec + (min*60);
};

const process_club_result_generic = (our_score, their_score, ot) => {
  if (our_score > their_score) {
    if (ot) {
      return '5';
    } else {
      return '1';
    }
  } else if (our_score <= their_score) {
    if (ot) {
      return '6';
    } else {
      return '2';
    }
  } else {
    throw new Error("unknown club result");
  }
}

const process_club_result_no_stats = (game, side) => {
  const our_score = util.coerce_int(game[`${side}_score`]);
  const other_side = side === 'away' ? 'home' : 'away';
  const their_score = util.coerce_int(game[`${other_side}_score`]);
  return process_club_result_generic(our_score, their_score, false);
}

const process_club_result = (match, game, side) => {
  const ot = game.stats.box_score.header.filter((h)=>h.startsWith('OT')).length > 0 ? true : false;
  const our_scores = Object.values(match.players[game[`${side}_club_id`]]).map((x)=>x.skgoals);
  const other_side = side === 'away' ? 'home' : 'away';
  const their_scores = Object.values(match.players[game[`${other_side}_club_id`]]).map((x)=>x.skgoals);
  let our_score = 0;
  let their_score = 0;
  if (our_scores.length > 0 && their_scores.length > 0) {
    our_scores.forEach((s) => our_score += util.coerce_int(s));
    their_scores.forEach((s) => their_score += util.coerce_int(s));
    our_score = isNaN(our_score) ? 0 : our_score;
    their_score = isNaN(their_score) ? 0 : their_score;
  } else {
    if (game.league_name === 'fbhl') {
      const home_score = game.home_score.match(/([0-9]+)/)[1];
      const away_score = game.away_score.match(/\([0-9+]\)\s+([0-9]+)/)[1];
      our_score = util.coerce_int(side === 'away' ? away_score : home_score);
      their_score = util.coerce_int(side === 'away' ? home_score : away_score);
    } else {
      our_score = util.coerce_int(game[`${side}_score`]);
      their_score = util.coerce_int(game[`${other_side}_score`]);
    }
  }
  return process_club_result_generic(our_score, their_score, ot);
};

const process_club_generic = function(game, side) {
  return {
    team_name: game[`${side}_team`],
    details: {
      name: game[`${side}_team`],
      clubId: game[`${side}_club_id`]
    },
    teamSide: side === 'away' ? '1' : '0',
  };
}

const process_club_no_stats = function(match, game, side) {
  const club = {
    ...process_club_generic(game, side),
    score: game[`${side}_score`],
    shots: 0,
    ppg: 0,
    ppo: 0,
    toa: 0,
    result: process_club_result_no_stats(game, side)
  };
  return club;
}

const process_club_stats = function(match, game, side) {
  const club = {
    ...process_club_generic(game, side),
    score: process_club_num(match, game, side, 'skgoals'),
    shots: process_club_num(match, game, side, 'skshots'),
    ppg: process_club_pp(game, side, 1),
    ppo: process_club_pp(game, side, 2),
    toa: process_club_toa(game, side),
    result: process_club_result(match, game, side)
  };
  return club;
}

const process_game_no_stats = function(game, schedule) {
  const match = {
    timestamp: new Date().getTime(),
    players: {},
    schedule
  };
  const away_club_id = resolve_club_id(game,game.away_team);
  const home_club_id = resolve_club_id(game,game.home_team);
  match.clubs = {}
  match.clubs[away_club_id] = process_club_no_stats(match, game, 'away');
  match.clubs[home_club_id] = process_club_no_stats(match, game, 'home');
  matches.push(match);
  schedule.stats = true;
  schedule.match = match;
}

const process_game_stats = function(game, schedule) {
    const stats = game.stats;
    if ('box_score' in stats) {
        schedule.box_score = process_box_score(game, stats.box_score);
    }
    const match = {
        timestamp: new Date().getTime(),
        players: {},
        schedule,
    };
    const away_club_id = resolve_club_id(game,game.away_team);
    const home_club_id = resolve_club_id(game,game.home_team);
    match.players[away_club_id] = process_player_stats(game, 'away');
    match.players[home_club_id] = process_player_stats(game, 'home');
    match.clubs = {};
    match.clubs[away_club_id] = process_club_stats(match, game, 'away');
    match.clubs[home_club_id] = process_club_stats(match, game, 'home');
    matches.push(match);
    schedule.stats = true;
    schedule.match = match;
}

const process_forfeit_draw = function(game, schedule) {
  schedule.stats = true;
  schedule.forfeit_draw = true;
}

const process_forfeit = function (game, schedule) {
  schedule.stats = true;
  const away_score = util.coerce_int(game.away_score);
  const home_score = util.coerce_int(game.home_score);

  if (away_score > home_score) {
    schedule.forfeit_winner = game.away_club_id;
  } else if (home_score > away_score) {
    schedule.forfeit_winner = game.home_club_id;
  } else {
    process_forfeit_draw(game, schedule);
  }
}

const process_game = function(game) {
    const schedule = {
        mso: {
            url: game.mso_source_url,
            league: game.league_name
        },
        season_id: game.season_id,
        date: resolve_datetime(game),
        away_club_id: util.coerce_int(resolve_away_club_id(game)),
        home_club_id: util.coerce_int(resolve_home_club_id(game)),
        game_type: game.game_type,
        insert_date: new Date(),
        insert_user: {
          displayName: 'website'
        }
    };
    game.away_club_id = schedule.away_club_id;
    game.home_club_id = schedule.home_club_id;

    const ff_draw_scores = ['-','0'];

    if ('stats' in game) {
        process_game_stats(game, schedule);
    } else if (game.away_score === game.home_score && ff_draw_scores.includes(game.away_score)) {
        process_forfeit_draw(game, schedule);
    } else if ('forfeit' in game) {
        process_forfeit(game, schedule);
    } else {
        process_game_no_stats(game, schedule);
    }
    schedules.push(schedule);
}

const add_team_to_db = async function(client, team) {
  const team_id = team.team_id;
  const season_id = team.season_id;
  const existing = await client.db(config.db).collection('teams').findOne({team_id,season_id});
  if (existing) {
    console.log(`Team ${team.team_id} already exists, skipping`);
    if (existing.team_name === team.team_name) {
      team._id = existing._id;
    } else {
      throw new Error("PROBLEM");
    }
  } else {
    console.log(`Team ${team.team_id}, ${team.team_name} does not exist, adding`);
    const r = await client.db(config.db).collection('teams').insertOne(team);
    team._id = r.insertedId;
  }
}

const add_match_to_db = async function(client, match) {
  const existing = await client.db(config.db).collection('matches').findOne({'mso.url':match.schedule.mso.url});
  if (existing) {
    if (matches.indexOf(match) % 150 == 0) {
      console.log(`Match ${matches.indexOf(match)+1}/${matches.length} already exists`);
    }
    match._id = existing._id;
    match.schedule.mso_match_id = match._id;
  } else {
    if (matches.indexOf(match) % 150 == 0) {
      console.log(`Adding Match ${matches.indexOf(match)+1}/${matches.length}`);
    }
    match.season_id = match.schedule.season_d;
    match.mso = match.schedule.mso;
    const s = match.schedule;
    delete match.schedule;
    const r = await client.db(config.db).collection('matches').insertOne(match);
    match._id = r.insertedId;
    match.schedule = s;
    match.schedule.mso_match_id = match._id;
  }
}

const add_schedule_to_db = async function(client, schedule) {
  const existing = await client.db(config.db).collection('schedules').findOne({'mso.url':schedule.mso.url});
  if (existing) {
    if (schedules.indexOf(schedule) % 150 == 0) {
      console.log(`Schedule ${schedules.indexOf(schedule)+1}/${matches.length} already exists`);
    }
    return;
  } else {
    if (schedules.indexOf(schedule) % 150 == 0) {
      console.log(`Adding schedule ${schedules.indexOf(schedule)+1}/${schedules.length}`);
    }
    delete schedule.match;
    await client.db(config.db).collection('schedules').insertOne(schedule);
  }
}

const import_mso = async function(client, games) {
    if (await cvar.get(client, 'mso_import_version', 0) === 1) {
      console.log("MSO Version 1, ignoring import");
      return;
    }

    if (!global.dev_mode) {
        console.log("NOT IN DEV MODE NOT IMPORING MSO");
        return;
    } else {
        console.log("IN DEV MODE: IMPORING MSO"); 
    }

    for (let g = 0;g < games.length;g++) {
        console.log(`process_game(${g+1}/${games.length})`);
        process_game(games[g]);
    }

    // add teams to db
    for (let t = 0;t < teams.length;t++) {
      await add_team_to_db(client, teams[t]);
    }

    // add matches to db
    for (let m = 0;m < matches.length;m++) {
      await add_match_to_db(client, matches[m]);
    }

    // add schedules to db
    for (let s = 0;s < schedules.length;s++) {
      await add_schedule_to_db(client, schedules[s]);
    }

    await cvar.set(client, 'mso_import_version', 1);
    console.log("MSO IMPORT COMPLETE");
}

module.exports = {
    import_mso
}
