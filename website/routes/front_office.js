const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const teams = require('../local/teams');
const db = require('../local/db');
const util = require('../local/util');
const users = require('../local/users');
const fa = require('../local/fa');
const trades = require('../local/trades');
const ObjectId = require('mongodb').ObjectId;
const discord = require('../local/discord');
const games = require('../local/games');
const config = global.config;
const s3 = require('../local/s3');

const offered_fa_tender = (user, free_agents) => {
    if (free_agents) {
        for (let f = 0;f < free_agents.length;f++) {
            if (free_agents[f].user_id === user.user_id) {
                return true;
            }
        }
    }
};

router.get('/:section', async function(req, res) {
    if (req.session.front_office_teams && req.session.front_office_teams.length > 0) {
        const client = await db.client();
        const render_locals = await view_config.get(client, req);
        render_locals.users = await users.all_users(client);
        req.query.idx = req.query.idx ? req.query.idx : 0;
        const team_mid = new ObjectId(req.session.front_office_teams[req.query.idx]._id);
        render_locals.team = await client.db(config.db).collection('teams').findOne({_id:team_mid});
        render_locals.team.users = render_locals.users.filter((u)=>render_locals.team.roster.includes(u.auth.username));
        render_locals.teams = await teams.season_teams(client, render_locals.team.season_id);
        render_locals.teams.forEach((t) => t.users = render_locals.users.filter((u)=>t.roster&&t.roster.includes(u.auth.username)));
        render_locals.free_agents = await fa.pending_free_agents_team(client, render_locals.team._id);
        render_locals.team_owner_user_id = render_locals.team.ownership && render_locals.team.ownership.owner ? render_locals.team.ownership.owner.user_id : null;
        render_locals.received_trade_offers = await trades.received_trade_offers(client, render_locals.team._id);
        render_locals.active_trade_offer = await trades.active_trade_offer(client, render_locals.team._id);
        render_locals.accepted_trade_offer = await trades.accepted_trade_offer(client, render_locals.team._id);
        const page = req.params.section ? req.params.section : 'index';
        if (req.params.section === 'fa') {
            render_locals.users = (await users.eligible_users(client, render_locals.team.season_id))
                .filter((user) => !offered_fa_tender(user, render_locals.free_agents))
                .sort((a,b)=>a.auth.username.localeCompare(b.auth.username));
        } else if (req.params.section === 'fo') {
            const _id = render_locals.team._id;
            render_locals.fo_request = await client.db(config.db).collection('fo_requests').findOne({team:{_id}});
            render_locals.candidates = await users.eligible_owners(client, render_locals.team._id);
        } else if (req.params.section === 'jersey') {
            render_locals.sides = ['HOME','AWAY','ALTERNATE'];
        } else if (req.params.section === 'lineups') {
            if (req.query.game_id) {
                const _id = new ObjectId(req.query.game_id);
                render_locals.game = await games.get_single_game(client, _id);
                render_locals.available_players = await users.lineup_available_users(client, render_locals.team, render_locals.game.date);
                render_locals.users = await users.get_usernames(client, Object.keys(render_locals.available_players));
            } else {
                render_locals.games = await games.get_team_incomplete_games(client, render_locals.team, util.date_add_days(new Date(), 7));
                let usernames = [];
                render_locals.games.forEach((game) => {
                    if (game.lineup) {
                        Object.values(game.lineup).forEach((lineup) => {
                            Object.values(lineup).forEach((p) => usernames.push(p));
                        });
                    }
                });
                usernames = util.array_unique(usernames);
                render_locals.users = await users.get_usernames(client, usernames);
            }
        } else if (req.params.section === 'upload'){
            if (req.query.game_id) {
                render_locals.game = await games.get_single_game(client, req.query.game_id);
            } else {
                render_locals.upload_games = await games.get_team_incomplete_games(client, render_locals.team, util.date_add_days(new Date(), 2));
            }
        }
        res.render(`front_office/${page}`, render_locals);
        await client.close();
    } else {
        res.redirect('/?status=No+Access');
    }
});

router.post('/:section', express.urlencoded({extended:true, limit: global.upload_limit}), async function(req, res) {
    let status_message = 'Owner Route Not Found';
    if (req.session.front_office_teams[req.query.idx]) {
        const client = await db.client();
        const team_mid = new ObjectId(req.session.front_office_teams[req.query.idx]._id);
        const team = await client.db(config.db).collection('teams').findOne({_id:team_mid});
        if (req.params.section === 'block') {
            const trade_block = Object.keys(req.body).filter((x)=>x!='team_id');
            const _id = new ObjectId(req.body.team_id);
            await client.db(config.db).collection('teams').updateOne({_id},{$set:{trade_block}});
            const other_teams = await client.db(config.db).collection('teams').find({_id:{$ne:team._id},season_id:team.season_id}).toArray();
            await discord.team_trade_block_updated(client, team, other_teams);
            status_message = "Trade Block Updated";
        } else if (req.params.section === 'fa') {
            const user_id = req.body.user_id;
            if (user_id === 'NONE') {
                status_message = 'No User Selected';
            } else {
                const team = new ObjectId(req.body._id);
                await fa.submit_tender(client, team, user_id);
                status_message = "FA Offer Tendered";
            }
        } else if (req.params.section === 'fo') {
            const _id = new ObjectId(req.body._id);
            const gm = req.body.gm;
            const agm = req.body.agm;
            const agm2 = req.body.agm2;
            await client.db(config.db).collection('fo_requests').insertOne({team:{_id},gm,agm,agm2});
            status_message = "FO Request Sent";
        } else if (req.params.section === 'jersey') {
            const uploads = req.files;
            if (uploads) {
                const jerseys = {};
                const fuploads = Object.keys(uploads);
                for (let f = 0;f < fuploads.length;f++) {
                    const jersey = fuploads[f];
                    jerseys[jersey] = await s3.upload(uploads[jersey]);
                }
                const _id = team._id;
                await client.db(config.db).collection('teams').updateOne({_id},{$set:{jerseys}});
                await discord.team_jersey_updated(client, _id);
                status_message = "Jersey Updated";
            }
        } else if (req.params.section === 'lineups') {
            const game_id = new ObjectId(req.query.game_id);
            const positions = ['center','left_wing','right_wing','left_defense','right_defense','goalie'];
            const lineup = {};
            const names = [];
            positions.forEach(p => {
                if (req.body[p] !== '') {
                    if (!names.includes(req.body[p])) {
                        lineup[p] = req.body[p];
                        names.push(req.body[p]);
                    }
                }
            });
            if (Object.keys(lineup).length === positions.length) {
                const game = await games.get_single_game(client, game_id);
                const avail = await users.lineup_available_users(client, team, game.date);
                const active_players = Object.values(lineup);
                const standby = [];
                for (const p in avail) {
                    if (avail[p] && !active_players.includes(p)) {
                        standby.push(p);
                    }
                }
                await games.set_lineup(client, game, team, lineup);
                await discord.lineup_changed(client, game, lineup, standby);
                status_message = "Lineup Set";
            } else {
                status_message = "Not all positions set properly, lineup invalid.";
            }
        } else if (req.params.section === 'release') {
            const release_block = Object.keys(req.body);
            const _id = team._id;
            await client.db(config.db).collection('teams').updateOne({_id},{$addToSet:{release_block:{$each:release_block}}});
            status_message = "Release Requests Updated";
        } else if (req.params.section === 'trades') {
            if (req.body.offer_id) {
                const offer_id = new ObjectId(req.body.offer_id);
                if (req.body.accept === '1') {
                    await trades.accept_trade_offer(client, offer_id);
                    await discord.accept_trade_offer(client, offer_id);
                    status_message = "Trade accepted and sent to Transactions for review";
                } else {
                    await trades.reject_trade_offer(client, offer_id);
                    await discord.reject_trade_offer(client, offer_id);
                    status_message = "Trade Rejected";
                }
            } else {
                const author_team = new ObjectId(req.body.author_team);
                const offer_team = new ObjectId(req.body.offer_team);
                const author_players = req.body.author_players.filter((p)=>p!=='');
                const offer_players = req.body.offer_players.filter((p)=>p!=='');
                if (author_players.length == 0 || offer_players.length == 0) {
                    status_message = "Trade Offer Rejected - No Players Entered";
                } else {
                    const trade_offer = {author_team,offer_team,author_players,offer_players};
                    await trades.submit_trade_offer(client, trade_offer);
                    await discord.submit_trade_offer(client, trade_offer);
                    status_message = "Trade Offer Sent";
                }
            }
        } else if (req.params.section === 'upload') {
            const game_id = req.body.game_id;
            const fields = ['1p','2p','3p','ot','so','tot'];
            const box_score = { away: {}, home: {} };
            fields.forEach((f) => {
                ['away', 'home'].forEach((s) => {
                    const v = util.coerce_int(req.body[`${s}_${f}`]);
                    box_score[s][f] = isNaN(v) ? 0 : v;
                });
            });
            const images = req.files ? req.files.images : [];
            await games.upload_team_files(client, game_id, team, {box_score,images});
            status_message = "Files Uploaded";
        }
        res.redirect(`/front_office/${req.params.section}?idx=${req.query.idx}&status=${encodeURIComponent(status_message)}`);
        await client.close();
    } else {
        res.redirect(`/?status=${encodeURIComponent('No Front Office Membership')}`);
    }
});

module.exports = router;
