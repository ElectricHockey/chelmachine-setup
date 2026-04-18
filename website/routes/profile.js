const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const users = require('../local/users');
const db = require('../local/db');
const teams = require('../local/teams');
const discord = require('../local/discord');
const fa = require('../local/fa');
const seasons = require('../local/seasons');
const config = global.config;

const valid_input = function(field, default_value) {
    if (field) {
        if (typeof field === 'string' || field instanceof String) {
            if (field.length > 0) {
                if (field != default_value) {
                    return true;
                }
            }
        }
    }
    return false;
}

const get_user_form_availability = function(body) {
    if (config.availability.enabled) {
        const days = config.availability.days;
        const times = config.availability.times;
        const availability = {};
        days.forEach((d) => {
            times.forEach((t) => {
                const f = `${d}.${t}`;
                availability[f] = body[f] === 'on' ? true : false;
            });
        });
        return availability;
    }
}

router.post('/', async function(req, res) {
    const client = await db.client();
    let status_message = 'Invalid Route';
    let valid = false;
    if (req.user && req.body.application === '1') {
        status_message = 'Application Not Submitted. Check your values and try again';
        if (valid_input(req.body.xbsx) || valid_input(req.body.ps5)) {
            const gamertags = { xbsx: req.body.xbsx, ps5: req.body.ps5 };
            Object.keys(gamertags).forEach((t)=>{if(gamertags[t]=='')delete gamertags[t];});
            if (!(await users.are_gamertags_unique(client, req.user.id, gamertags))) {
                status_message = 'Application Not Submitted. One of your gamertags is not unique.';
            } else {
                const positions = [];
                const position_labels = ['center','left_wing','right_wing','left_defense','right_defense','goalie'];
                for (const pos in position_labels) {
                    if (req.body[`position_${position_labels[pos]}`] === 'on') {
                        positions.push(position_labels[pos]);
                    }
                }
                const handedness = req.body.handedness;
                const availability = get_user_form_availability(req.body);
                const season_id = await seasons.current_season_id(client);
                const application = {gamertags,console,positions,handedness,season_id};
                await discord.application_submitted(client, req.user.id, application);
                await users.update_record(client, req.user.id, {application,gamertags,availability});

                // update session
                req.session.application = true;
                req.session.gamertags = gamertags;
                status_message = 'Application Submitted';
                valid = true;
            }
        } else {
            status_message = 'Application Not Submitted. You must provide a valid gamertag for at least one console.';
        }
    } else if (req.user) {
        const gamertags = { xbsx: req.body.xbsx, ps5: req.body.ps5 };
        Object.keys(gamertags).forEach((cp)=>{if(gamertags[cp]=='')delete gamertags[cp]});
        const unique_tags = await users.are_gamertags_unique(client, req.user.id, gamertags);
        if (!unique_tags) {
            status_message = 'Another user already has one of the gamertags specified.';
        } else {
            const availability = get_user_form_availability(req.body);
            const streaming = {};
            ['twitch','youtube'].forEach((f) => streaming[f] = req.body[f]);
            const positions = [];
            Object.keys(req.body).filter((e) => e.startsWith('position_')).forEach((elem) => {
                positions.push(elem.slice('position_'.length));
            });
            await discord.profile_positions_changed(client, req.user.id, positions);
            await users.update_record(client, req.user.id, {availability,gamertags,positions,streaming});
            status_message = 'Profile Updated';
        }
    } else {
        res.redirect(`/?status=${encodeURIComponent('No User')}`);
        await client.close();
        return;
    }
    const fa_offers = await fa.pending_free_agent_offers(client, req.user.id);
    await client.close();
    if (valid && fa_offers) {
        res.redirect('/offer');
    } else {
        res.redirect(`/profile?status=${encodeURIComponent(status_message)}`);
    }
});

router.get('/', async function(req, res) {
    const client = await db.client();
    const render_locals = await view_config.get(client, req);
    const user = req.user ? await users.get_record(client, req.user.id) : null;
    if (user) {
        render_locals.hide_app_submission_notice = true;
        render_locals.user = user;
        await users.add_members_to_users(client, [user]);
        render_locals.handedness = ['SELECT HANDEDNESS', 'Right Handed', 'Left Handed', 'Both / Ambidextrous'];
        render_locals.season_id = await seasons.current_season_id(client);
        if (user && user.application && user.application.season_id == render_locals.season_id) {
            render_locals.free_agent = await users.free_agent(client, user.auth.username);
            render_locals.teams = await teams.current_teams(client);
        } else if (user) {
            render_locals.fa_offers = await fa.pending_free_agent_offers(client, user.id);
        }
        render_locals.embed_description = 'User Profile';
        res.render('profile', render_locals);
    } else {
        res.redirect(`/?status=${encodeURIComponent('Not Logged In')}`);
    }
    await client.close();
});

module.exports = router;
