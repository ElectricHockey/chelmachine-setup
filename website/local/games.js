const ObjectId = require('mongodb').ObjectId;
const teams = require('./teams');
const util = require('./util');
const config = global.config;
const s3 = require('./s3');
const { DateTime } = require('luxon');

const add_pretty_date_to_games = function(games) {
    games.forEach((g)=> {
        if (g.date) {
            g.pretty_date = util.pretty_date(g.date);
        }
    });
}

const valid_game = (game) => {
    if (game.home_team && game.away_team) {
        //if (!(game.home_team.visible === false || game.away_team.visible === false))
            return true;
    }

    return false;
}

const filter_valid_games = (games) => {
    return games.filter((g) => valid_game(g));
};

const add_teams_to_games = async function (client, games) {
    let seasons = {};
    games.forEach((g)=>seasons[g.season_id] = 1);
    seasons = Object.keys(seasons).map((s)=>util.coerce_int(s));
    const teams = await client.db(config.db).collection('teams').find(util.mongo_or_array('season_id',seasons)).sort({season_id:-1}).toArray();
    games.forEach((game) => {
        game.away_team = teams.find((t)=>t._id.equals(game.away_team_id));
        game.home_team = teams.find((t)=>t._id.equals(game.home_team_id));

        if (!game.away_team || !game.home_team)
        {
            // try to find based on the name
            game.away_team = teams.find((t)=>t.team_name==game.away);
            game.home_team = teams.find((t)=>t.team_name==game.home);

            if (!game.away_team || !game.home_team) {
                game.valid = false;
                return;
            }
        }
        
        if (game.game_stats || !isNaN(game.forfeit_winner)) {
            game.winning_team = game.winning_club_id == game.away_club_id ? game.away_team : game.home_team;
            game.losing_team = game.winning_club_id == game.home_club_id ? game.away_team : game.home_team;
            util.assert(game.winning_team && game.losing_team);
        } else if (game.stats && !game.forfeit_draw) {
            throw new Error("Unsupported Game Type");
        }
    });
};

const fixup_matches = function(matches) {
    matches.forEach((match) => {
        // fix null clubs
        Object.keys(match.clubs).forEach((k) => {
            if (match.clubs[k] == null) {
                match.clubs[k] = {};
            }
        });

        // fix goals
        if (config.count_cpu_goals) {
            const clubs = Object.values(match.clubs);
            clubs.forEach((club) => {
                if (!('gfraw' in club) || !('garaw' in club)) {
                    club.gfraw = club.score;
                    club.garaw = clubs.find((c)=>c!=club).score;
                }
                club.gfraw = util.coerce_int(club.gfraw);
                club.garaw = util.coerce_int(club.garaw);
            });
        } else {
            const tally = {};
            Object.keys(match.players).forEach((player_club) => {
                tally[player_club] = 0;
                Object.values(match.players[player_club]).forEach((player) => {
                    tally[player_club] += util.coerce_int(player.skgoals);
                });
            });
            Object.keys(match.clubs).forEach((club_id) => {
                const club = match.clubs[club_id];
                club.gfraw = tally[club_id];
                club.garaw = tally[Object.keys(tally).find((c)=>c!=club_id)];
            });
        }

        // fix result codes
        Object.values(match.clubs).forEach((c) => {
            const valids = ['1','2','5','6'];
            if (!valids.includes(c.result)) {
                if (c.gfraw > c.garaw) {
                    c.result = '1';
                } else {
                    c.result = '2';
                }
            }
        });
    });
}

const fixup_stats = function(game) {
    if (game.game_stats) {
        const match = game.game_stats;
        const away_team_id = game.away_club_id;
        const home_team_id = game.home_club_id;
        const club_ids = Object.keys(match.clubs).map((x)=>util.coerce_int(x));
        if (!club_ids.includes(away_team_id)) {
            const invalid_team_id = club_ids.find((c)=>c!=home_team_id);
            match.clubs[away_team_id] = match.clubs[invalid_team_id];
            delete match.clubs[invalid_team_id];
            match.players[away_team_id] = match.players[invalid_team_id];
            delete match.players[invalid_team_id];
        } else if (!club_ids.includes(home_team_id)) {
            const invalid_team_id = club_ids.find((c)=>c!=away_team_id);
            match.clubs[home_team_id] = match.clubs[invalid_team_id];
            delete match.clubs[invalid_team_id];
            match.players[home_team_id] = match.players[invalid_team_id];
            delete match.players[invalid_team_id];
        }
        const is_winning_club = (c) => {
            if (c)
                return c.gfraw >= c.garaw;
        };
        const winning_club_id = util.coerce_int(Object.keys(match.clubs).find((cid)=>is_winning_club(match.clubs[cid])));
        const losing_club_id = util.coerce_int(Object.keys(match.clubs).find((cid)=>cid!=winning_club_id));
        util.assert(!isNaN(winning_club_id) && !isNaN(losing_club_id));
        game.winning_club = Object.values(match.clubs).find((club)=>match.clubs[winning_club_id]==club);
        game.losing_club = Object.values(match.clubs).find((club)=>match.clubs[losing_club_id]==club);
        if (game.winning_club && game.losing_club) {
            game.overtime = game.winning_club.result == '5';
            game.winning_club_id = winning_club_id;
            game.losing_club_id = losing_club_id;
            Object.values(match.players).forEach((cp) => {
                if (cp == null)
                    return;
                Object.values(cp).forEach((p)=>p.game_type=game.game_type);
            });
        }
    } else if (game.forfeit_winner) {
        const winning_club_id = game.forfeit_winner;
        const losing_club_id = winning_club_id == game.away_club_id ? game.home_club_id : game.away_club_id;
        util.assert(!isNaN(winning_club_id) && !isNaN(losing_club_id));
        game.overtime = false;
        game.winning_club_id = winning_club_id;
        game.losing_club_id = losing_club_id;
    }
}

const get_single_game = async function(client, game_id) {
    try {
        const game = await client.db(config.db).collection('schedules').findOne({_id:new ObjectId(game_id)});
        if (game) {
            await get_stats_for_games(client, [game]);
            await add_teams_to_games(client, [game]);
            await add_pretty_date_to_games([game]);
            if (valid_game(game)) {
                return game;
            }
        }
    } catch(e) {
        return undefined;
    }
}

const set_lineup = async function(client, game, team, lineup) {
    const upd = {$set:{}};
    upd['$set'][`lineup.${team._id}`] = lineup;
    await client.db(config.db).collection('schedules').updateOne({_id:game._id},upd);
}

const remove_invalid_stats_from_games = async function(client, games) {
    const game_ids = games.map((g)=>g._id.toString());
    if (game_ids.length == 0) {
        return;
    }
    const invalid_stats = await client.db(config.db).collection('invalid_stats').find(util.mongo_or_array('game_id',game_ids)).toArray();
    invalid_stats.forEach((invalid) => {
        const game = games.find((g)=>g._id.toString()==invalid.game_id);
        if (game.game_stats) {
            Object.values(game.game_stats.players).forEach((cp) => {
                Object.keys(cp).forEach((playerid) => {
                    const player = cp[playerid];
                    if (player.playername == invalid.playername) {
                        delete cp[playerid];
                    }
                });
            });
        }
    });
}

const get_games_with_filter = async function(client, filter) {
    const all_games = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await add_pretty_date_to_games(all_games);
    await get_stats_for_games(client, all_games);
    await add_teams_to_games(client, all_games);
    return filter_valid_games(all_games);
}

const get_stats_for_games = async function(client, games, show_invalid_stats) {
    const match_ids = games.map((g)=>g.linked_match_id).filter((m)=>m);
    if (match_ids.length == 0) {
        return;
    }
    let records;
    if (match_ids.length == 1) {
        records = [await client.db(config.db).collection('matches').findOne({_id:match_ids[0]})];
    } else {
        records = await client.db(config.db).collection('matches').find(util.mongo_or_array('_id',match_ids)).toArray();
    }
    games.forEach((game) => {
        const stats = records.find((r)=>r._id.equals(game.linked_match_id));
        const vstats = () => {
            if (stats) {
                if (Object.keys(stats.players).length != 2) {
                    game.stats = false;
                    return false;
                }

                game.game_stats = structuredClone(stats);
                game.game_stats._id = stats._id;
                return true;
            }
        }
        if (vstats()) {
            const stats = game.game_stats;
            const clubs = Object.keys(stats.clubs).map((x)=>util.coerce_int(x));
            const remap_club_id = (old_id, new_id) => {
                stats.clubs[new_id] = stats.clubs[old_id];
                if (stats.clubs[new_id]) {
                    if (stats.clubs[new_id].details)
                        stats.clubs[new_id].details.clubId = new_id;
                }
                delete stats.clubs[old_id];
                stats.players[new_id] = stats.players[old_id];
                delete stats.players[old_id];
            };
            if (!clubs.includes(game.away_club_id) && !clubs.includes(game.home_club_id)) {
                const entries = Object.entries(stats.clubs);
                const invalid_away = entries.find((x) => x[1].teamSide == '1');
                const invalid_home = entries.find((x) => x[1].teamSide == '0');

                if (invalid_away && invalid_home) {
                    remap_club_id(invalid_away[0], game.away_club_id);
                    remap_club_id(invalid_home[0], game.home_club_id);
                } else {
                    delete game.game_stats;
                    game.stats = false;
                }
            } else if (!clubs.includes(game.away_club_id)) {
                const invalid_club_id = clubs.find((c)=>c!=game.home_club_id);
                const valid_club_id = game.away_club_id;
                remap_club_id(invalid_club_id, valid_club_id);
            } else if (!clubs.includes(game.home_club_id)) {
                const invalid_club_id = clubs.find((c)=>c!=game.away_club_id);
                const valid_club_id = game.home_club_id;
                remap_club_id(invalid_club_id, valid_club_id);
            }
        }
    });
    if (!show_invalid_stats) {
        await remove_invalid_stats_from_games(client, games);
    }
    fixup_matches(games.filter((g)=>g.game_stats).map((g)=>g.game_stats));
    games.forEach((g)=>fixup_stats(g));
}

const submit_json_stats = async function(user, client, game_id, clubs, overtime) {
    const json_sources = [];

    // convert csv data to manual stat data
    for (const c in clubs) {
        const club = clubs[c];
        club.skaters = [];
        club.goalies = [];

        json_sources.push(club.skaterjson);
        json_sources.push(club.goaliejson);

        for (const s in club.skaterjson) {
            const skater = club.skaterjson[s];

            if (skater['"PLAYERS"'].replace(/^"(.*)"$/, '$1') === 'TOTAL') {
                continue;
            }

            club.skaters.push({
                sktoiminutes: 60 - util.coerce_int(skater.PIM),
                sktoiseconds: 0,
                skpos: skater['"POS"'].replace(/^"(.*)"$/, '$1'),
                skgoals: skater.G,
                skshots: skater.S,
                skname: skater['"PLAYERS"'].replace(/^"(.*)"$/, '$1'),
                skassists: skater.A,
                skhits: skater.HITS,
                skpim: skater.PIM,
                skblkshots: skater.BS,
                skplusminus: skater['+/-'],
                skgiveaways: skater.GVA,
                sktakeaways: skater.TKA,
                skints: skater.INT,
                skfowins: skater.FOW, 
                skfoffs: skater.FO,
                skpassattempts: skater.PA,
                skpasses: skater.PC
            });
        }

        for (const g in club.goaliejson) {
            const goalie = club.goaliejson[g];

            if (goalie['"GOALIES"'].replace(/^"(.*)"$/, '$1') === 'TOTAL') {
                continue;
            }

            club.goalies.push({
                glname: goalie['"GOALIES"'].replace(/^"(.*)"$/, '$1'),
                gltoiminutes: goalie.TOI,
                gltoiseconds: 0,
                glsa: goalie.SA,
                glga: goalie.GA,
                glpim: goalie.PIM,
                glgoals: goalie.G,
                glassists: goalie.A,
                glsv: goalie.SV
            });
        }
    }

    return await submit_manual_stats(user, client, game_id, clubs, overtime, { csv: true, json_sources });
}

const submit_manual_stats = async function(user, client, game_id, clubs, overtime, meta) {
    const manual_stats = {
        timestamp: Date.now(),
        user,
        clubs: {},
        players: {},
        meta,
        manual_stats: true
    };
    const tally = {};

    // add player data
    for (const club_id in clubs) {
        manual_stats.players[club_id] = {};
        const inclub = clubs[club_id];

        tally[club_id] = { score: 0, shots: 0 };

        // add skaters
        for (const s in clubs[club_id].skaters) {
            const skater = inclub.skaters[s];
            const player_id = `skater_${s}`;
            const sktoiseconds = util.coerce_int(skater.sktoiminutes) * 60 + util.coerce_int(skater.sktoiseconds);

            if (skater.skpos === 'C') {
                skater.position = 'center';
                skater.posSorted = '5';
            } else if (skater.skpos === 'LW') {
                skater.position = 'leftWing';
                skater.posSorted = '4';
            } else if (skater.skpos === 'RW') {
                skater.position = 'rightWing';
                skater.posSorted = '3';
            } else if (skater.skpos === 'LD') {
                skater.position = 'defenseMen';
                skater.posSorted = '2';
            } else if (skater.skpos === 'RD') {
                skater.position = 'defenseMen';
                skater.posSorted = '1';
            } else if (skater.skpos === 'D') {
                skater.position = 'defenseMen';
                skater.posSorted = '-1';
            }

            tally[club_id].score += util.coerce_int(skater.skgoals);
            tally[club_id].shots += util.coerce_int(skater.skshots);

            manual_stats.players[club_id][player_id] = {
                manual_stat_position: skater.skpos,
                playername: skater.skname,
                position: skater.position,
                posSorted: skater.posSorted,
                sktoiseconds,
                gltoiseconds: 0,
                toi: skater.sktoiminutes,
                ratingOffense: skater.skoffrtg,
                ratingDefense: skater.skdefrtg,
                ratingTeamplay: skater.skteamrtg,
                skgoals: skater.skgoals,
                skassists: skater.skassists,
                skhits: skater.skhits,
                skpim: skater.skpim,
                skshots: skater.skshots,
                skshotpct: util.coerce_int(skater.skgoals) / util.coerce_int(skater.skshots),
                skbs: skater.skblkshots,
                skplusmin: skater.skplusminus,
                skgiveaways: skater.skgiveaways,
                sktakeaways: skater.sktakeaways,
                skinterceptions: skater.skints,
                skfow: skater.skfowins,
                skfol: util.coerce_int(skater.skfoffs) - util.coerce_int(skater.skfowins),
                skfopct: util.coerce_int(skater.skfowins) / util.coerce_int(skater.skfoffs),
                skpassattempts: skater.skpassattempts,
                skpasses: skater.skpasses,
                skpasspct: util.coerce_int(skater.skpasses) / util.coerce_int(skater.skpassattempts)
            };
        }

        // add goalies
        for (const g in clubs[club_id].goalies) {
            const goalie = inclub.goalies[g];
            const player_id = `goalie_${g}`;
            const gltoiseconds = util.coerce_int(goalie.gltoiminutes) * 60 + util.coerce_int(goalie.gltoiseconds);

            tally[club_id].score += util.coerce_int(goalie.glgoals);

            manual_stats.players[club_id][player_id] = {
                manual_stat_position: 'G',
                playername: goalie.glname,
                position: 'goalie',
                posSorted: '0',
                sktoiseconds: 0,
                gltoiseconds,
                toi: goalie.gltoiminutes,
                ratingOffense: goalie.gloffrtg,
                ratingDefense: goalie.gldefrtg,
                ratingTeamplay: goalie.glteamrtg,
                glshots: goalie.glsa,
                glga: goalie.glga,
                skpim: goalie.glpim,
                skgoals: goalie.glgoals,
                skassists: goalie.glassists,
                glsaves: goalie.glsv,
                glgaa: util.compute_gaa(goalie.gla, gltoiseconds),
                glsavepct: util.coerce_int(goalie.glsv) / util.coerce_int(goalie.glsa)
            }
        }
    }

    // add club aggregate data
    for (const club_id in clubs) {
        const inclub = clubs[club_id];
        const game = await client.db(config.db).collection('schedules').findOne({_id:new ObjectId(game_id)});
        const team_info = await teams.team_by_id(client, game.season_id, parseInt(club_id));
        const gfraw = tally[club_id].score.toString();
        const garaw = tally[Object.keys(tally).find((k)=>k!=club_id)].score.toString();
        
        manual_stats.clubs[club_id] = {
            team_name: team_info.team_name,
            gfraw,
            garaw,
            score: tally[club_id].score,
            shots: tally[club_id].shots,
            ppg: inclub.ppg,
            ppo: inclub.ppo,
            toa: util.coerce_int(inclub.toa_minutes) * 60 + util.coerce_int(inclub.toa_seconds),
            details: {
                name: team_info.team_name,
                clubId: club_id,
            },
            teamSide: inclub.teamSide,
        }
    }

    // record result now that we have aggregation
    for (const club_id in clubs) {
        const ourscore = manual_stats.clubs[club_id].score;
        let theirscore;

        for (const other_club_id in clubs) {
            if (other_club_id != club_id) {
                theirscore = manual_stats.clubs[other_club_id].score;
                break;
            }
        }

        if (ourscore > theirscore) {
            manual_stats.clubs[club_id].result = overtime ? '5' : '1';
        } else {
            manual_stats.clubs[club_id].result = overtime ? '6' : '2';
        }
    }

    // enter match into collection
    const r = await client.db(config.db).collection('matches').insertOne(manual_stats);

    // set game stats
    const schedules = client.db(config.db).collection('schedules');
    await schedules.updateOne({_id: new ObjectId(game_id)}, { $set: { stats: true, linked_match_id: r.insertedId } });

    return `Stats added for ${game_id}`;
}

const submit_merged_stats = async function (user, client, game_id, overtime, ea_matchids) {
    const merged_stats = {
        timestamp: Date.now(),
        user,
        ea_matchids,
        clubs: {},
        players: {},
        // Version 2: use coerce_int instead of parseInt
        // Version 3: no longer tally skater goals for game result, use gfraw/garaw instead
        // Version 4: bring over all stats
        merge_version: 4, 
    };
    const avgs = ['glgaa','ratingDefense','ratingOffense','ratingTeamplay','skshotonnetpct'];
    const pcts = ['glbrksavepct','glpensavepct','glsavepct','skfopct','skpasspct','skshotpct'];
    const matches = await client.db(config.db).collection('matches').find(util.mongo_or_array('matchId',ea_matchids)).toArray();
    matches.forEach((match_stats) => {
        // add club data
        for (const club_id in match_stats.clubs) {
            const inclub = match_stats.clubs[club_id];

            if (merged_stats.clubs[club_id] === undefined) {
                merged_stats.clubs[club_id] = structuredClone(inclub);
            } else {
                const ints = ['garaw','gfraw','losses','opponentScore','passa','passc','ppg','ppo','score','shots','toa','goals','goalsAgainst'];
                const pass = ['clubDivision','cNhlOnlineGameType','memberString','opponentClubId','opponentTeamArtAbbr','result','scoreString',
                    'teamArtAbbr','teamSide','winnerByDnf','winnerByGoalieDnf','details'];
                Object.keys(inclub).forEach((k) => {
                    if (pass.includes(k)) {
                        return;
                    } else if (ints.includes(k)) {
                        const src = util.coerce_int(merged_stats.clubs[club_id][k]);
                        const dst = util.coerce_int(inclub[k]);
                        merged_stats.clubs[club_id][k] = (src+dst).toString();
                    } else {
                        throw new Error("Unhandled Field");
                    }
                });
            }
        }

        // add player data
        for (const playerclub in match_stats.players) {
            for (const playerid in match_stats.players[playerclub]) {
                const player = match_stats.players[playerclub][playerid];
                if (merged_stats.players[playerclub] === undefined) {
                    merged_stats.players[playerclub] = {};
                }
                const out_player = merged_stats.players[playerclub][player.playername];

                if (out_player === undefined) {
                    merged_stats.players[playerclub][player.playername] = {
                        ...player
                    };
                } else {
                    const pass = ['class','isGuest','opponentClubId','opponentTeamId','player_dnf','playerLevel','pNhlOnlineGameType',
                        'position','posSorted','teamId','teamSide','playername','clientPlatform'];
                    const ints = ['glbrksaves','glbrkshots','gldsaves','glga','glpensaves','glpenshots','glpkclearzone','glpokechecks',
                        'glsaves','glshots','glsoperiods','opponentScore','score','skassists','skbs','skdeflections','skfol','skfow',
                        'skgiveaways','skgoals','skgwg','skhits','skinterceptions','skpassattempts','skpasses','skpenaltiesdrawn',
                        'skpim','skpkclearzone','skplusmin','skpossession','skppg','sksaucerpasses','skshg','skshotattempts','skshots',
                        'sktakeaways','toi','toiseconds'];
                    Object.keys(player).forEach((f) => {
                        if (pass.includes(f)) {
                            return;
                        } else if (ints.includes(f)) {
                            const src = util.coerce_int(merged_stats.players[playerclub][player.playername][f]);
                            const dst = util.coerce_int(player[f]);
                            const val = src + dst;
                            merged_stats.players[playerclub][player.playername][f] = val.toString();
                        } else if (avgs.includes(f)) {
                            const src = util.coerce_float(merged_stats.players[playerclub][player.playername][f]);
                            const dst = util.coerce_float(player[f]);
                            const val = src + dst;
                            merged_stats.players[playerclub][player.playername][f] = val.toFixed(2).toString();
                        } else if (pcts.includes(f)) {
                            return;
                        } else {
                            throw new Error("Unhandled player field");
                        }
                    });
                }
            }
        }
    });

    avgs.forEach((f) => {
        Object.values(merged_stats.players).forEach((players) => {
            Object.values(players).forEach((player) => {
                if (f in player) {
                    const v = util.coerce_float(player[f]) / ea_matchids.length;
                    player[f] = v.toFixed(2).toString();
                }
            });
        });
    });

    pcts.forEach((f) => {
        const fields = {
            glbrksavepct: { num: 'glbrksaves', den: 'glbrkshots' },
            glpensavepct: { num: 'glpensaves', den: 'glpenshots' },
            glsavepct: { num: 'glsaves', den: 'glshots' },
            skfopct: { fo: true },
            skpasspct: { num: 'skpasses', den: 'skpassattempts' },
            skshotpct: { num: 'skgoals', den: 'skshots' },
        };
        Object.values(merged_stats.players).forEach((players) => {
            Object.values(players).forEach((player) => {
                if (f in player) {
                    if (fields[f].fo) {
                        const num = util.coerce_int(player.skfow);
                        const den = util.coerce_int(player.skfow) + util.coerce_int(player.skfol);
                        const pct = isNaN(num/den) ? 0 : num / den;
                        player[f] = (pct*100).toFixed(2).toString();
                    } else {
                        const num = util.coerce_int(player[fields[f].num]);
                        const den = util.coerce_int(player[fields[f].den]);
                        const pct = isNaN(num/den) ? 0 : num / den;
                        player[f] = (pct*100).toFixed(2).toString();
                    }
                }
            });
        });
    });

    for (const club_id in merged_stats.clubs) {
        const garaw = util.coerce_int(merged_stats.clubs[club_id].garaw);
        const gfraw = util.coerce_int(merged_stats.clubs[club_id].gfraw);

        merged_stats.clubs[club_id].score = gfraw.toString();

        if (gfraw > garaw) {
            merged_stats.clubs[club_id].result = overtime ? '5' : '1';
        } else {
            merged_stats.clubs[club_id].result = overtime ? '6' : '2';
        }
    }

    const linked_match_id = (await client.db(config.db).collection('matches').insertOne(merged_stats)).insertedId;
    const _id = new ObjectId(game_id);
    await client.db(config.db).collection('schedules').updateOne({_id},{$set:{stats:true,linked_match_id}});
    return `Merged Stats added for ${game_id}`;
}

const get_completed_games_in_date_range = async function(client, season_id, game_type, start_date, end_date, show_invalid_stats) {
    const filter = {
        season_id,
        stats: true,
        $and: [
            {date: {$gte: DateTime.fromISO(start_date).toJSDate()}},
            {date: {$lte: DateTime.fromISO(end_date).toJSDate()}}
        ],
    };
    if (game_type) {
        filter.game_type = game_type;
    }
    const games = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await get_stats_for_games(client, games, show_invalid_stats);
    await add_teams_to_games(client, games);
    await add_pretty_date_to_games(games);
    return filter_valid_games(games);
}

const get_completed_games = async function(client, season_id, game_type, show_invalid_stats) {
    const filter = { season_id, stats: true };
    if (game_type) {
        filter.game_type = game_type;
    }
    const games = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await get_stats_for_games(client, games, show_invalid_stats);
    await add_teams_to_games(client, games);
    await add_pretty_date_to_games(games);
    return filter_valid_games(games);
}

const get_team_completed_games_for_season = async function(client, season_id, team_object_id, game_type) {
    const filter = {season_id,game_type,stats:true,$or:[{away_team_id:team_object_id},{home_team_id:team_object_id}]};
    const games = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await get_stats_for_games(client, games);
    await add_teams_to_games(client, games);
    await add_pretty_date_to_games(games);
    return games;
}

const get_team_incomplete_games = async function(client, team, max_date) {
    const filter = {
        stats:{$ne:true},
        $or:[{away_team_id:team._id},{home_team_id:team._id}],
        date:{$lte:max_date},
        season_id:team.season_id,
    };
    const games = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await add_teams_to_games(client, games);
    await add_pretty_date_to_games(games);
    return filter_valid_games(games);
}

const get_team_stats_for_games = function(games) {
    const team_stats = {};
    games.forEach((game) => {
        let away_team_stats, home_team_stats;
        [game.away_team,game.home_team].forEach((team) => {
            if (!(team._id in team_stats)) {
                team_stats[team._id] = { gp: 0, ggp: 0, points: 0, goals: 0, goalsgp: 0, shots: 0, assists: 0, assistsgp: 0, 
                    glsaves: 0, glshots: 0, glga: 0, hits: 0, pim: 0, ht: 0, plusmin: 0, bs: 0, giveaways: 0, takeaways: 0, 
                    interceptions: 0, fow: 0, fo: 0, fopct: 0, passes: 0, passattempts: 0, passpct: 0, glwins: 0, gllosses: 0,
                    glotlosses: 0, sktoiseconds: 0, gltoiseconds: 0, glshutouts: 0,
                    glsavep: 0, gltotalwins: 0, glgaa: Infinity, goalpct: 0, glpoints: 0, wins: 0, losses: 0, otwins: 0, otlosses: 0,
                    goalie: true, notgoalie: true, team_stat: true, club_id: team.team_id, team,
                    gskpenaltiesdrawn: 0, gskgoals: 0, gskgwg: 0, gskassists: 0, glbrkshots: 0, glbrksaves: 0, 
                    glbrksavepct: 0, glpenshots: 0, glpensavepct: 0, gldsaves: 0, glpokechecks: 0, glpkclearzone: 0, glsoperiods: 0,
                    skppg: 0, skgwg: 0, skshg: 0, skdeflections: 0, skpenaltiesdrawn: 0, skshotattempts: 0, sksaucerpasses: 0,
                    skpossession: 0, skpkclearzone: 0
                };
            }

            if (team == game.away_team) {
                away_team_stats = team_stats[team._id];
            } else {
                home_team_stats = team_stats[team._id];
            }
        });

        ++away_team_stats.gp;
        ++away_team_stats.ggp;
        ++home_team_stats.gp;
        ++home_team_stats.ggp;

        if (game.forfeit_winner) {
            const winning_team = (game.forfeit_winner == game.away_club_id) ? game.away_team : game.home_team;
            const losing_team = (game.forfeit_winner == game.away_club_id) ? game.home_team : game.away_team;
            const winning_tstat = team_stats[winning_team._id];
            const losing_tstat = team_stats[losing_team._id];

            ++winning_tstat.wins;
            ++losing_tstat.losses;
        } else if (game.game_stats) {
            Object.keys(game.game_stats.clubs).forEach((club_id) => {
                const club = game.game_stats.clubs[club_id];
                const players = game.game_stats.players[club_id];
                const tstats = (club_id == game.away_club_id) ? away_team_stats : home_team_stats;
                if (!players)
                    return;
                Object.values(players).forEach((player) => {
                    tstats.points += util.coerce_int(player.skgoals) + util.coerce_int(player.skassists);
                    tstats.pim += util.coerce_int(player.skpim);
                    tstats.goals += util.coerce_int(player.skgoals);
                    tstats.assists += util.coerce_int(player.skassists);
                    tstats.hits += util.coerce_int(player.skhits);
                    tstats.ht += Math.floor(util.coerce_int(player.skgoals) / 3);
                    tstats.plusmin += util.coerce_int(player.skplusmin);
                    tstats.bs += util.coerce_int(player.skbs);
                    tstats.giveaways += util.coerce_int(player.skgiveaways);
                    tstats.takeaways += util.coerce_int(player.sktakeaways);
                    tstats.interceptions += util.coerce_int(player.skinterceptions);
                    tstats.fow += util.coerce_int(player.skfow);
                    tstats.fo += util.coerce_int(player.skfol) + util.coerce_int(player.skfow);
                    tstats.passes += util.coerce_int(player.skpasses);
                    tstats.passattempts += util.coerce_int(player.skpassattempts);
                    tstats.shots += util.coerce_int(player.skshots);
                    tstats.skppg += util.coerce_int(player.skppg);
                    tstats.skgwg += util.coerce_int(player.skgwg);
                    tstats.skshg += util.coerce_int(player.skshg);
                    tstats.skdeflections += util.coerce_int(player.skdeflections);
                    tstats.skpenaltiesdrawn += util.coerce_int(player.skpenaltiesdrawn);
                    tstats.skshotattempts += util.coerce_int(player.skshotattempts);
                    tstats.sksaucerpasses += util.coerce_int(player.sksaucerpasses);
                    tstats.skpossession += util.coerce_int(player.skpossession);
                    tstats.skpkclearzone += util.coerce_int(player.skpkclearzone);

                    if (player.posSorted == '0') {
                        tstats.glga += util.coerce_int(player.glga);
                        tstats.glsaves += util.coerce_int(player.glsaves);
                        tstats.glshots += util.coerce_int(player.glshots);
                        tstats.gltoiseconds += util.coerce_int(player.toiseconds);
                        tstats.glpoints += util.coerce_int(player.skgoals) + util.coerce_int(player.skassists);
                        tstats.glgaa = util.compute_gaa(tstats.glga, tstats.gltoiseconds);
                        tstats.glsavep = tstats.glsaves / tstats.glshots;
                        tstats.gskpenaltiesdrawn += util.coerce_int(player.skpenaltiesdrawn);
                        tstats.gskgoals += util.coerce_int(player.skgoals);
                        tstats.gskgwg += util.coerce_int(player.skgwg);
                        tstats.gskassists += util.coerce_int(player.skassists);
                        tstats.glbrkshots += util.coerce_int(player.glbrkshots);
                        tstats.glbrksaves += util.coerce_int(player.glbrksaves);
                        tstats.glbrksavepct = tstats.glbrksaves / tstats.glbrkshots;
                        tstats.glpenshots += util.coerce_int(player.glpenshots);
                        tstats.glpensaves += util.coerce_int(player.glpensaves);
                        tstats.glpensavepct = tstats.glpensaves / tstats.glpenshots;
                        tstats.gldsaves += util.coerce_int(player.gldsaves);
                        tstats.glpokechecks += util.coerce_int(player.glpokechecks);
                        tstats.glpkclearzone += util.coerce_int(player.glpkclearzone);
                        tstats.glsoperiods += util.coerce_int(player.glsoperiods);

                        if (club.gfraw > club.garaw) {
                            tstats.glwins++;
                            if (club.garaw == 0) {
                                tstats.glshutouts++;
                            }
                        } else {
                            tstats.gllosses++;
                        }

                        if (club.result == '5') {
                            ++tstats.glwins;
                        } else if (club.result == '6') {
                            ++tstats.glotlosses;
                        }
                    } else {
                        tstats.pointsgp = (tstats.points / tstats.gp).toFixed(3);
                        tstats.goalsgp = (tstats.goals / tstats.gp).toFixed(3);
                        tstats.assistsgp = (tstats.assists / tstats.gp).toFixed(3);
                        tstats.goalpct = tstats.goals / tstats.shots;
                        tstats.fopct = tstats.fo > 0 ? tstats.fow / tstats.fo : 0;
                        tstats.passpct = tstats.passes / tstats.passattempts;
                        tstats.sktoiseconds += util.coerce_int(player.toiseconds);
                    }
                });
            });
        }
    });

    return Object.values(team_stats);
};

const resolve_box_score = async function(client, game_id) {
    const _id = new ObjectId(game_id);
    const game = await client.db(config.db).collection('schedules').findOne({_id});
    await get_stats_for_games(client, [game]);
    if (game.files && game.game_stats) {
        const stats = game.game_stats;
        for (const c in stats.clubs) {
            const r = stats.clubs[c].result;
            if (r === '1' || r === '5') { // winner / ot winner
                if (game.files[c]) {
                    const box_score = game.files[c].box_score;
                    await client.db(config.db).collection('schedules').updateOne({_id},{$set:{box_score}});
                }
            }
        }
    }
}

const unlink_stats = async function(client, game_id) {
    const schedules = client.db(config.db).collection('schedules');
    await schedules.updateOne({_id: new ObjectId(game_id)}, { 
        $unset: { stats: '', forfeit_winner: '', forfeit_draw: '', linked_match_id: '' } });
}

const upload_team_files = async function(client, game_id, team, files) {
    const _id = new ObjectId(game_id);
    const box_score = files.box_score;
    const images = [];
    const up = {$set:{}};
    up['$set'][`files.${team._id}`] = {box_score,images};
    if (!Array.isArray(files.images)) { files.images = [files.images]; }
    const fimages = Object.values(files.images);
    for (let f = 0;f < fimages.length;f++) {
        images.push(await s3.upload(fimages[f]));
    }
    await client.db(config.db).collection('schedules').updateOne({_id},up);
}

const accumulate_team_standings = function(game, current_teams) {
    current_teams.forEach((team) => {
        if (team.gp === undefined) {
            ['gp','wins','otwins','losses','otlosses','points'].forEach((f) => team[f] = 0);
        }
    });

    if (game.game_stats !== undefined) {
        const club_ids = Object.keys(game.game_stats.clubs);
        for (let c = 0;c < club_ids.length;c++) {
            const club_stats = game.game_stats.clubs[club_ids[c]];
            const team = club_stats.teamSide == '1' ? game.away_team : game.home_team;

            ++team.gp;

            if (game.linked_match_id !== undefined) {
                if (club_stats.garaw !== undefined && club_stats.gfraw !== undefined) {
                    const garaw = util.coerce_int(club_stats.garaw);
                    const gfraw = util.coerce_int(club_stats.gfraw);
                    if (gfraw > garaw) {
                        ++team.wins;
                        team.points += 2;
                        team.otwins += (club_stats.result === '5') ? 1 : 0;
                    } else if (gfraw < garaw) {
                        if (club_stats.result === '6') {
                            ++team.otlosses;
                            team.points += 1;
                        } else {
                            ++team.losses;
                        }
                    }
                } else {
                    throw new Error(`game ${game._id} doesn't have raw stats`);
                }
            } else {
                throw new Error("UNKNOWN GAME TO ACCUMULATE");
            }
        }
    } else {
        const teams = current_teams.filter((t)=>t._id.equals(game.away_team_id)||t._id.equals(game.home_team_id));
        for (const i in teams) {
            const team = teams[i];

            ++team.gp;

            if (game.forfeit_draw === true) {
                continue;
            } else {
                if (game.forfeit_winner === team.team_id) {
                    ++team.wins;
                    team.points += 2;
                } else {
                    ++team.losses;
                }
            }
        }
    }
}

const default_game_type = async function(client, season_id) {
    const season_games_complete = await client.db(config.db).collection('schedules').find({stats: true, season_id}).toArray();
    let game_type = 'regular';
    for (let g = 0;g < season_games_complete.length;g++) {
        const game = season_games_complete[g];
        if (game.game_type === 'regular') {
            game_type = 'regular';
        } else if (game.game_type === 'preseason' && !game_type) {
            game_type = 'preseason';
        } else if (game.game_type === 'playoffs') {
            return 'playoffs';
        }
    }
    return game_type;
}

const add_streaming_options = async function(client, games) {
    const teams = {};
    let usernames = {};
    games.forEach((game) => {
        teams[game.away_team.team_id] = game.away_team;
        teams[game.home_team.team_id] = game.home_team;
    });
    const team_arr = Object.values(teams);
    team_arr.forEach((t) => {
        if (t.roster) {
            t.roster.forEach((u) => usernames[u] = 1);
        }
    });
    usernames = Object.keys(usernames);
    if (usernames.length == 0) {
        return;
    }
    const user_filter = {...util.mongo_or_array('auth.username',usernames),streaming:{$exists:true}};
    const proj = {};
    ['user_id','auth.id','auth.username','member','gamertags','streaming'].forEach((f)=>proj[f]=1);
    const users = await client.db(config.db).collection('users').find(user_filter).project(proj).toArray();
    users.forEach((u) => {
        if (u.streaming) {
            let valid_streaming = false;
            Object.keys(u.streaming).forEach((src) => {
                const url = u.streaming[src];
                if (util.is_valid_url(url)) {
                    valid_streaming = true;
                }
            });
            if (valid_streaming) {
                team_arr.forEach((team) => {
                    if (team.roster) {
                        const match_user = team.roster.find((tr)=>tr==u.auth.username);
                        if (match_user) {
                            if (!team.streaming) {
                                team.streaming = [];
                            }
                            team.streaming.push(u);
                        }
                    }
                });
            }
        }
    });
}

const get_candidate_matches_for_game = function(matches, game) {
    const fm = matches.filter((m) => {
        const team_ids = Object.keys(m.clubs).map((c)=>util.coerce_int(c));
        const cands = [game.away_club_id,game.home_club_id,game.away_team.team_id,game.home_team.team_id];
        if (team_ids.find((t)=>cands.includes(t))) {
            const match_time = m.timestamp * 1000;
            const schedule_time = game.date.getTime();
            const diff = Math.abs(match_time - schedule_time);
            const cmp = 1000 * 60 * 60 * 12; // 12 hours
            return diff < cmp;
            //return true;
        }
    });
    return fm;
}

const get_match_title = function (match) {
    const club_names = [];
    const club_goals = [];
    for (const club_id in match.clubs) {
        const club = match.clubs[club_id];
        const n = () => club.details ? club.details.name : '?';
        club_names.push(n());
        club_goals.push(club.goals);
    }

    return `${match.matchId} (${club_goals[0]}) ${club_names[0]} VS ${club_names[1]} (${club_goals[1]})`;
}

module.exports = {
    accumulate_team_standings,
    add_streaming_options,
    default_game_type,
    game_types: ['regular','playoffs','preseason'],
    get_games_with_filter,
    get_single_game,
    get_completed_games,
    get_completed_games_in_date_range,
    get_team_completed_games_for_season,
    get_team_incomplete_games,
    get_team_stats_for_games,
    resolve_box_score,
    set_lineup,
    submit_json_stats,
    submit_manual_stats,
    submit_merged_stats,
    upload_team_files,
    unlink_stats,
    get_stats_for_games,
    get_candidate_matches_for_game,
    get_match_title
};