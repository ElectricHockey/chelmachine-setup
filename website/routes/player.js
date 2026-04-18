const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const seasons = require('../local/seasons');
const games = require('../local/games');
const teams = require('../local/teams');
const util = require('../local/util');
const stats = require('../local/stats');
const config = global.config;

/* GET home page. */
router.get('/', async function(req, res) {
    const client = await db.client();
    let gamertags = {};
    const username = req.query.username;
    let user;
    if (req.query.username) {
        user = await client.db(config.db).collection('users').findOne({'auth.username':req.query.username});
        if (user) {
            gamertags = user.gamertags;
        } else {
            res.redirect(`/?status=${encodeURIComponent('Player not found')}`);
            await client.close();
            return;
        }
    } else if (req.query.xbsx) {
        gamertags.xbsx = req.query.xbsx;
    } else if (req.query.ps5) {
        gamertags.ps5 = req.query.ps5;
    }
    if (gamertags && Object.keys(gamertags).length == 0) {
        res.redirect(`/?status=${encodeURIComponent('Unknown Player')}`);
        await client.close();
        return;
    }
    const render_locals = await view_config.get(client, req);
    render_locals.seasons = await seasons.get_seasons(client);
    render_locals.current_season = req.query.season_id ? 
        render_locals.seasons.find((s)=>s.season_id==util.coerce_int(req.query.season_id)) : render_locals.seasons[0];
    if (!render_locals.current_season)
        render_locals.current_season = render_locals.seasons[0];
    const season_id = render_locals.current_season.season_id;
    render_locals.game_type = req.query.game_type ? req.query.game_type : 'regular';
    const all_games = await games.get_completed_games(client, season_id, render_locals.game_type);
    const all_matches = all_games.map((g)=>g.game_stats).filter((g)=>g);
    const player_filter_base = (club_id,p) => {
        if (gamertags && p.clientPlatform in gamertags) {
            return p.playername == gamertags[p.clientPlatform];
        }
    };
    const filter_player_not_goalie = (club_id,p) => {if(player_filter_base(club_id,p)){return p.position!='goalie';}};
    const filter_player_goalie = (club_id,p) => {if(player_filter_base(club_id,p)){return p.position=='goalie';}};
    render_locals.skater_season_stats = stats.accumulate_matches(all_matches, filter_player_not_goalie);
    render_locals.goalie_season_stats = stats.accumulate_matches(all_matches, filter_player_goalie);
    if (username) {
        render_locals.team = await teams.team_by_rostered(client, username);
    }
    render_locals.game_log = [];
    render_locals.skater_game_log = [];
    render_locals.goalie_game_log = [];

    if (user) {
        user.membership = await client.db(config.db).collection('guild_members').findOne({userId:user.user_id});
        const proc_szn_stats = (stats) => {
            if (stats) {
                stats.forEach((stat)=>stat.user=user);
            }
        };
        proc_szn_stats(render_locals.skater_season_stats);
        proc_szn_stats(render_locals.goalie_season_stats);
    }

    all_games.forEach((game) => {
        try {
            if (game.game_stats) {
                const match = game.game_stats;
                Object.keys(match.players).forEach((club_id) => {
                    const club_players = match.players[club_id];
                    Object.values(club_players).forEach((player) => {
                        if (player && player.clientPlatform in gamertags) {
                            if (gamertags[player.clientPlatform] == player.playername) {
                                if (player.position == 'goalie') {
                                    render_locals.goalie_game_log.push({...player,club_id,game,user});
                                } else {
                                    render_locals.skater_game_log.push({...player,club_id,game,user});
                                }
                            }
                        }
                    });
                });
            }
        } catch(e) {
            console.log("ERR");
        }
    });

    render_locals.embed_description = 'Player Card';
    res.render('player', render_locals);
    await client.close();
});

module.exports = router;
