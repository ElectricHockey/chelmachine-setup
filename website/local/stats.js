const util = require('./util');
const config = global.config;

const accumulate_matches = function(matches, fn) {
    let players = {};
    matches.forEach((match) => {
        Object.keys(match.players).forEach((club_id) => {
            const cp = match.players[club_id];
            if (!cp)
                return;
            Object.values(cp).forEach((p) => {
                let aplayer = players[p.playername];
                if (fn && !fn(club_id, p, match)) {
                    return;
                }
                if (!aplayer) {
                    players[p.playername] = structuredClone(p);
                    aplayer = players[p.playername];
                    aplayer.wins = 0;
                    aplayer.games = 1;
                    aplayer.glshutouts = 0;
                    aplayer.hattricks = Math.floor(util.coerce_int(aplayer.skgoals)/3);
                    aplayer.glwins = 0;
                    aplayer.gllosses = 0;
                    aplayer.glotlosses = 0;
                    aplayer.matches = [match._id];
                } else {
                    aplayer.matches.push(match._id);
                    aplayer.games++;
                    aplayer.hattricks += Math.floor(util.coerce_int(p.skgoals)/3);
                    const pass = ['class','clientPlatform','posSorted','playername'];
                    for (const f in p) {
                        if (f == 'position') {
                            if (p.position == 'goalie') {
                                aplayer.position = 'goalie';
                                aplayer.posSorted = '0';
                            }
                        } else if (!pass.includes(f)) {
                            const src = util.coerce_int(aplayer[f]);
                            const dst = util.coerce_int(p[f]) + src;
                            aplayer[f] = dst;
                        } else if (!(f in aplayer)) {
                            aplayer[f] = p[f];
                        }
                    }
                }
                const club = match.clubs[club_id];
                if (util.coerce_int(club.gfraw) > util.coerce_int(club.garaw)) {
                    aplayer.wins++;
                    if (p.position == 'goalie') {
                        ++aplayer.glwins;

                        if (util.coerce_int(club.garaw) == 0) {
                            ++aplayer.glshutouts;
                        }
                    }
                } else if (p.position == 'goalie') {
                    if (club.result == '6') {
                        ++aplayer.glotlosses;
                    } else {
                        ++aplayer.gllosses;
                    }
                }
            });
        });
    });
    players = Object.values(players);
    players.forEach((p) => {
        ['glgaa'].forEach((f) => {
            if (f in p) {
                p[f] = parseFloat(p[f])/p.games;
            }
        });
        const dp = (n,d) => {
            n = util.coerce_int(n);
            d = util.coerce_int(d);
            const pct = isNaN(n/d) ? 0 : n/d;
            return (pct*100).toFixed(2).toString();
        };
        p.glbrksavepct = dp(p.glbrksaves,p.glbrkshots);
        p.glpensavepct = dp(p.glpensaves,p.glpenshots);
        p.glsavepct = dp(p.glsaves,p.glshots);
        p.skfopct = dp(p.skfow,util.coerce_int(p.skfow)+util.coerce_int(p.skfol));
        p.skpasspct = dp(p.skpasses,p.skpassattempts);
        p.skshotpct = dp(p.skgoals,p.skshots);
        ['playerLevel','ratingDefense','ratingOffense','ratingTeamplay'].forEach((f) => {
            if (f in p) {
                p[f] = parseFloat(p[f])/p.games;
            }
        });
    });
    return players;
}

const add_player_team_to_accumulated_stats = function (games, stats) {
    stats.forEach((player) => {
        const player_games = games.filter((g) => {
            if (g.game_stats)
                return player.matches.includes(g.game_stats._id);
        }).sort((a,b)=>b.date.getTime()-a.date.getTime());
        if (player_games.length > 0) {
            const game = player_games[0];
            Object.entries(game.game_stats.players).forEach((entry) => {
                const club_id = entry[0];
                Object.values(entry[1]).forEach((game_player) => {
                    if (game_player.playername == player.playername) {
                        if (club_id == game.away_club_id) {
                            player.team = game.away_team;
                        } else if (club_id == game.home_club_id) {
                            player.team = game.home_team;
                        }
                    }
                });
            });
        }
    });
}

const add_discord_users_to_stats = async function(client, stats) {
    const gamertags = {};
    stats.forEach((stat) => {
        if ('clientPlatform' in stat && 'playername' in stat) {
            const clientPlatform = stat.clientPlatform;
            const playername = stat.playername;
            if (!(clientPlatform in gamertags)) {
                gamertags[clientPlatform] = [];
            }
            gamertags[clientPlatform].push(playername);
        }
    });
    const searches = [];
    Object.keys(gamertags).forEach((clientPlatform) => {
        gamertags[clientPlatform].forEach((gamertag) => {
            const o = {};
            o[`gamertags.${clientPlatform}`] = gamertag;
            searches.push(o);
        });
    });
    if (searches.length == 0) {
        return;
    }
    const filter = {$or:searches};
    const proj = {};
    ['user_id','auth.id','auth.avatar','auth.username','auth.global_name','gamertags'].forEach((f)=>proj[f]=1);
    const users = await client.db(config.db).collection('users').find(filter).project(proj).toArray();
    const user_ids = users.map((u)=>u.user_id);
    const members = await client.db(config.db).collection('guild_members').find(util.mongo_or_array('userId',user_ids)).toArray();
    const member_map = {};
    members.forEach((m)=>member_map[m.userId]=m);
    users.forEach((u)=>u.membership=member_map[u.user_id]);
    stats.forEach((stat) => {
        if ('clientPlatform' in stat && 'playername' in stat) {
            try {
               stat.user = users.find((u) => u.gamertags[stat.clientPlatform] == stat.playername);
            } catch(err) {
                //ignore
            }
        }
    });
    // merge ps5/xbox users if needed
    for (let st = 0;st < stats.length;++st) {
        const s = stats[st];
        if (s.user) {
            const merges = [];
            for (let n = st+1;n < stats.length;++n) {
                const c = stats[n];
                if (c.user && c.user.auth.username == s.user.auth.username) {
                    merges.push(c);
                }
            }
            merges.forEach((merge) => {
                Object.keys(s).forEach((field) => {
                    const skip = ['user', 'class','glbrksavepct','glgaa','glpensavepct', 'glsavepct', 'isGuest',
                        'opponentClubId', 'opponentTeamId', 'playerLevel', 'pNhlOnlineGameType', 'position',
                        'posSorted', 'ratingDefense', 'ratingOffense', 'ratingTeamplay', 'skfopct', 'skpasspct',
                        'skshotonnetpct', 'skshotpct', 'teamId', 'teamSide', 'playername', 'clientPlatform', 'game_type'];
                    const ints = ['glbrksaves','glbrkshots','gldsaves','glga','glpensaves','glpenshots',
                        'glpkclearzone', 'glpokechecks', 'glsaves', 'glshots', 'glsoperiods', 'opponentScore',
                        'player_dnf', 'score', 'skassists', 'skbs', 'skdeflections', 'skfol', 'skfow', 
                        'skgiveaways', 'skgoals', 'skgwg', 'skhits', 'skinterceptions', 'skpassattempts',
                        'skpasses', 'skpenaltiesdrawn', 'skpim', 'skpkclearzone', 'skplusmin', 'skpossession',
                        'skppg', 'sksaucerpasses', 'skshg', 'skshotattempts', 'skshots', 'sktakeaways', 'toi',
                        'toiseconds', 'wins', 'games', 'glshutouts', 'hattricks', 'glwins', 'gllosses', 'glotlosses'];
                    if (skip.includes(field)) {
                        return;
                    } else if (ints.includes(field)) {
                        s[field] = util.coerce_int(s[field]) + util.coerce_int(merge[field]);
                    }
                    //throw new Error(`Unknown Field ${field}`);
                });

                s.skpasspct = s.skpasses / s.skpassattempts;
                s.skfopct = s.skfow / (s.skfow + s.skfol);
                s.skshotpct = s.skgoals / s.skshots;
                s.glsavepct = s.glga / s.glshots;
                s.ratingDefense = (s.ratingDefense + s.ratingDefense) / 2;
                s.ratingOffense = (s.ratingOffense + s.ratingOffense) / 2;
                s.ratingTeamplay = (s.ratingTeamplay + s.ratingTeamplay) / 2;
                s.glpensavepct = s.glpensaves / s.glpenshots;
                s.glbrksavepct = s.glbrksaves / s.glbrkshots;
                s.skshotonnetpct = (s.skshotonnetpct + s.skshotonnetpct) / 2;

                if (s.position == 'goalie') {
                    s.glgaa = util.compute_gaa(s.glga, s.toiseconds);
                }

                if (s.position != merge.position) {
                    s.position = 'multiple';
                    s.posSorted = '-2';
                }

                merge.visibility = 'hidden';
                s.visibility = 'visible';
            });
        }
    }
}

const filter_player_stats = function(match, fn) {
    const result = [];
    Object.keys(match.clubs).forEach((club_id) => {
        const players = match.players[club_id];
        Object.values(players).forEach((player) => {
            player.team_id = util.coerce_int(club_id);
            if (!fn || fn(player)) {
                result.push(player);
            }
        });
    });
    return result;
}

module.exports = {
    accumulate_matches,
    add_player_team_to_accumulated_stats,
    add_discord_users_to_stats,
    filter_player_stats
}
