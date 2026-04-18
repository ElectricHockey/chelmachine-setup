const config = global.config;
const util = require('./util');
const games = require('./games');

const add_playoff_series = async function(client, playoff_series) {
    await client.db(config.db).collection('playoffs').insertOne(playoff_series);
}

const playoff_series_for_season = async function(client, season_id) {
    const series = await client.db(config.db).collection('playoffs').find({season_id}).toArray();
    series.sort((a,b) => config.playoffs.rounds.indexOf(b.playoff_round) - config.playoffs.rounds.indexOf(a.playoff_round));
    const game_type = 'playoffs';
    const filter = {season_id,game_type};
    const pgames = await client.db(config.db).collection('schedules').find(filter).sort({date:1}).toArray();
    await games.get_stats_for_games(client, pgames);
    series.forEach((s) => {
        s.teams.forEach((t)=>t.record = 0);
        const teams = s.teams.map((o)=>o.team_id);
        pgames.forEach((game) => {
            if (teams.includes(game.away_club_id) && teams.includes(game.home_club_id)) {
                if (!s.games) {
                    s.games = [];
                }
                s.games.push(game);
            }
        });
    });
    series.forEach((s) => {
        if (!s.games) return;
        s.games.forEach((g) => {
            if (g.stats) {
                if (g.game_stats) {
                    g.away_score = g.game_stats.clubs[g.away_club_id].gfraw;
                    g.home_score = g.game_stats.clubs[g.home_club_id].gfraw;

                    Object.keys(g.game_stats.clubs).forEach((club_id) => {
                        const team_id = util.coerce_int(club_id);
                        s.teams.forEach((team) => {
                            if (team.team_id == team_id) {
                                const result = g.game_stats.clubs[club_id];
                                const gf = util.coerce_int(result.gfraw);
                                const ga = util.coerce_int(result.garaw);
                                if (gf > ga) {
                                    team.record++;
                                }
                            }
                        });
                    });
                } else if (g.forfeit_winner != undefined) {
                    s.teams.forEach((team) => {
                        if (team.team_id == g.forfeit_winner) {
                            ++team.record;
                        }
                    });
                } else { 
                    if (!g.forfeit_draw) {
                        throw new Error ("Unhandled game type");
                    }
                }
            }
        });
    });
    return series;
}

const remove_playoff_series = async function(client, _id) {
    await client.db(config.db).collection('playoffs').deleteOne({_id});
}

module.exports = {
    add_playoff_series,
    playoff_series_for_season,
    remove_playoff_series
}
