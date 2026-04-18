
const games = require('./games');
const config = global.config;

const get_player_invalid_stats = async function(client, playername) {
    const c = await client.db(config.db).collection('invalid_stats').find({playername});
    const invalid_games = [];
    for await (const invalid_stat of c) {
        invalid_games.push(invalid_stat.game_id);
    }
    return invalid_games;
}

const get_active_season_player_names = async function(client, season_id, show_invalid_stats) {
    const seasons_games = await games.get_completed_games(client, season_id, 'regular', show_invalid_stats);
    const player_dict = {};

    for (const g in seasons_games) {
        const game = seasons_games[g];
        if (game.game_stats !== undefined && game.game_stats !== null) {
            for (const c in game.game_stats.players) {
                const player_club = game.game_stats.players[c];
                for (const p in player_club) {
                    player_dict[player_club[p].playername] = true;
                }
            }
        }
    }

    const player_names = [];
    for (const p in player_dict) {
        player_names.push(p);
    }

    return player_names.sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

const get_active_season_stats = async function(client, playername, season_id, show_invalid_stats) {
    const seasons_games = await games.get_completed_games(client, season_id, undefined, show_invalid_stats);
    const invalidated_games = await get_player_invalid_stats(client, playername);
    const player_games = [];

    for (const g in seasons_games) {
        const game = seasons_games[g];
        if (game.game_stats !== undefined) {
            for (const c in game.game_stats.players) {
                const player_club = game.game_stats.players[c];
                for (const p in player_club) {
                    const player = player_club[p];
                    if (player.playername === playername) {
                        player_games.push({
                            valid: invalidated_games.includes(game._id.toString()) ? false : true,
                            game,
                            player
                        });
                    }
                }
            }
        }
    }

    return player_games.sort((a,b) => a.game.date.getTime() - b.game.date.getTime());
}

const rename_player = async function(client, user, oldplayername, newplayername) {
    // update invalid stats
    const coll_invalid_stats = client.db(config.db).collection('invalid_stats');
    const ci = coll_invalid_stats.find({playername:oldplayername});
    const new_invalid_stats = [];
    for await (const invalid_stat of ci) {
        new_invalid_stats.push(invalid_stat);
    }
    for (const invalid_stat of new_invalid_stats) {
        const _id = invalid_stat._id;
        const playername = newplayername;
        await coll_invalid_stats.updateOne({_id},{$set: { playername }});
    }

    // update matches
    const matches = await client.db(config.db).collection('matches').find().toArray();
    const updates = [];
    matches.forEach((match) =>  {
        Object.values(match.players).forEach((cp) => {
            Object.values(cp).forEach((player) => {
                if (player.playername == oldplayername) {
                    player.playername = newplayername;
                    updates.push({
                        _id: match._id,
                        players: match.players
                    });
                }
            });
        });
    });
    for (let u = 0;u < updates.length;u++) {
        const _id = updates[u]._id;
        const players = updates[u].players;
        await client.db(config.db).collection('matches').updateOne({_id},{$set:{players}});
    }
}

const set_stat_validation = async function(client, user, playername, games_arr, stats_valid) {
    const coll_invalid_stats = client.db(config.db).collection('invalid_stats');
    const timestamp = new Date();

    for (const g in games_arr) {
        const game_id = games_arr[g];

        // always clear the collection of the document in question
        await coll_invalid_stats.deleteOne({playername, game_id});

        if (stats_valid === false) {
            await coll_invalid_stats.insertOne({playername, game_id, timestamp, user});
        }
    }

    return games_arr.length;
};

module.exports = {
    get_active_season_player_names,
    get_active_season_stats,
    get_player_invalid_stats,
    rename_player,
    set_stat_validation,
}